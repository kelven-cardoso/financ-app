package tech.kelvencardoso.financ

import android.app.Notification
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import org.json.JSONObject
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Lê as notificações dos apps de banco escolhidos. Só segue o que fala de dinheiro (tem "R$")
 * e nunca o que parece código de segurança ou senha. O resto é ignorado e não sai do aparelho.
 */
class NotifService : NotificationListenerService() {

    override fun onListenerConnected() {
        try {
            EnvioWorker.agendar(applicationContext)
        } catch (e: Throwable) {
            Log.w(TAG, "não agendou o envio", e)
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return
        try {
            tratar(applicationContext, sbn)
        } catch (e: Throwable) {
            Log.w(TAG, "captura falhou", e)
        }
    }

    private fun tratar(c: Context, sbn: StatusBarNotification) {
        val pacote = sbn.packageName ?: return
        if (pacote == c.packageName) return
        val n = sbn.notification ?: return
        val ex = n.extras ?: return
        val titulo = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
        val texto = (ex.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: ex.getCharSequence(Notification.EXTRA_TEXT))
            ?.toString()?.trim().orEmpty()
        if (titulo.isEmpty() && texto.isEmpty()) return
        Prefs.registrarVisto(c, pacote)
        if (!Prefs.apps(c).contains(pacote)) return
        if ((n.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return
        val tudo = titulo + "\n" + texto
        if (!DINHEIRO.containsMatchIn(tudo) || SENSIVEL.containsMatchIn(tudo)) return

        val agora = System.currentTimeMillis()
        val assinatura = sha256(pacote + "|" + sbn.key + "|" + titulo + "|" + texto)
        if (Prefs.jaVisto(c, assinatura, agora)) return
        val quando = if (sbn.postTime > 0) sbn.postTime else agora
        val app = rotulo(c, pacote)

        val o = JSONObject()
        o.put("id", sha256(assinatura + "|" + quando).substring(0, 40))
        o.put("app", app)
        o.put("pacote", pacote)
        o.put("titulo", titulo.take(300))
        o.put("texto", texto.take(3000))
        o.put("quando", quando)
        Fila.adicionar(c, o)
        val hora = SimpleDateFormat("dd/MM HH:mm", Locale("pt", "BR")).format(Date(quando))
        Prefs.registrarCaptura(c, hora + " · " + app + " · " + titulo.take(48))
        EnvioWorker.agendar(c)
    }

    companion object {
        private const val TAG = "Financ"
        private val DINHEIRO = Regex("R\\$\\s?\\d")
        private val SENSIVEL = Regex("(c[oó]digo|senha|token|verifica[cç][aã]o|autentica[cç][aã]o)", RegexOption.IGNORE_CASE)
        private val NOMES = mapOf("com.nu.production" to "Nubank")

        fun rotulo(c: Context, pacote: String): String {
            return try {
                val pm = c.packageManager
                pm.getApplicationLabel(pm.getApplicationInfo(pacote, 0)).toString()
            } catch (e: Exception) {
                NOMES[pacote] ?: pacote
            }
        }

        fun sha256(s: String): String {
            val d = MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8))
            val sb = StringBuilder()
            for (b in d) sb.append(String.format("%02x", b))
            return sb.toString()
        }
    }
}
