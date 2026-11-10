package tech.kelvencardoso.financ

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import java.security.SecureRandom

/** Preferências locais da captura (ficam só neste aparelho). */
object Prefs {
    const val PADRAO_APPS = "com.nu.production"
    private const val JANELA_REPETIDA_MS = 90_000L

    private fun p(c: Context): SharedPreferences =
        c.applicationContext.getSharedPreferences("captura", Context.MODE_PRIVATE)

    /** Chave deste aparelho: nasce aqui e só vai para o servidor no pareamento. */
    fun chave(c: Context): String {
        val sp = p(c)
        val atual = sp.getString("chave", null)
        if (!atual.isNullOrEmpty()) return atual
        val b = ByteArray(32)
        SecureRandom().nextBytes(b)
        val nova = Base64.encodeToString(b, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        sp.edit().putString("chave", nova).apply()
        return nova
    }

    fun appsTexto(c: Context): String = p(c).getString("apps", PADRAO_APPS) ?: PADRAO_APPS

    fun apps(c: Context): Set<String> =
        appsTexto(c).split('\n', ',', ';', ' ').map { it.trim() }.filter { it.isNotEmpty() }.toSet()

    fun salvarApps(c: Context, texto: String) {
        val limpo = texto.split('\n', ',', ';', ' ').map { it.trim() }.filter { it.isNotEmpty() }.distinct().joinToString("\n")
        p(c).edit().putString("apps", limpo).apply()
    }

    fun configurado(c: Context): Boolean = p(c).getBoolean("configurado", false)

    fun marcarConfigurado(c: Context) {
        p(c).edit().putBoolean("configurado", true).apply()
    }

    /** 0 = ainda não testado, 1 = servidor aceitou a chave, 2 = servidor recusou. */
    fun pareado(c: Context): Int = p(c).getInt("pareado", 0)

    fun definirPareado(c: Context, v: Int) {
        if (pareado(c) != v) p(c).edit().putInt("pareado", v).apply()
    }

    private fun lista(c: Context, nome: String): List<String> =
        (p(c).getString(nome, "") ?: "").split('\n').filter { it.isNotEmpty() }

    private fun porNaFrente(c: Context, nome: String, item: String, max: Int) {
        val atual = lista(c, nome)
        if (atual.firstOrNull() == item) return
        val nova = (listOf(item) + atual.filter { it != item }).take(max)
        p(c).edit().putString(nome, nova.joinToString("\n")).apply()
    }

    /** Apps que mandaram notificação há pouco (ajuda a descobrir o nome do pacote do banco). */
    fun registrarVisto(c: Context, pacote: String) = porNaFrente(c, "vistos", pacote, 15)

    fun vistos(c: Context): List<String> = lista(c, "vistos")

    fun registrarCaptura(c: Context, linha: String) = porNaFrente(c, "capturas", linha.replace('\n', ' '), 8)

    fun capturas(c: Context): List<String> = lista(c, "capturas")

    /** A mesma notificação repostada em seguida (atualização do sistema) conta uma vez só. */
    @Synchronized
    fun jaVisto(c: Context, assinatura: String, agora: Long): Boolean {
        val mapa = LinkedHashMap<String, Long>()
        for (linha in lista(c, "recentes")) {
            val i = linha.lastIndexOf('|')
            if (i <= 0) continue
            val t = linha.substring(i + 1).toLongOrNull() ?: continue
            if (agora - t < JANELA_REPETIDA_MS) mapa[linha.substring(0, i)] = t
        }
        val repetida = mapa.containsKey(assinatura)
        mapa[assinatura] = agora
        val texto = mapa.entries.toList().takeLast(40).joinToString("\n") { it.key + "|" + it.value }
        p(c).edit().putString("recentes", texto).apply()
        return repetida
    }
}
