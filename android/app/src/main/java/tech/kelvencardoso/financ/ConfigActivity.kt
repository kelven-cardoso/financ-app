package tech.kelvencardoso.financ

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.util.TypedValue
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

/** Tela nativa da captura: permissões, pareamento com o servidor e situação. */
class ConfigActivity : Activity() {
    private lateinit var corpo: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Prefs.marcarConfigurado(this) // mantido: indica que a tela já foi aberta
        val rolagem = ScrollView(this)
        corpo = LinearLayout(this)
        corpo.orientation = LinearLayout.VERTICAL
        val m = dp(20)
        corpo.setPadding(m, m, m, m)
        rolagem.addView(corpo)
        setContentView(rolagem)
    }

    override fun onResume() {
        super.onResume()
        montar()
    }

    private fun dp(v: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    private fun texto(s: String, tamanho: Float = 15f, negrito: Boolean = false, cor: Int = Color.parseColor("#1E293B"), acima: Int = 6): TextView {
        val t = TextView(this)
        t.text = s
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, tamanho)
        t.setTextColor(cor)
        if (negrito) t.setTypeface(t.typeface, Typeface.BOLD)
        t.setPadding(0, dp(acima), 0, dp(2))
        corpo.addView(t)
        return t
    }

    private fun secao(s: String) = texto(s, 17f, true, Color.parseColor("#0F2A4A"), 22)

    private fun nota(s: String) = texto(s, 13f, false, Color.parseColor("#64748B"), 4)

    private fun botao(s: String, acao: () -> Unit): Button {
        val b = Button(this)
        b.text = s
        b.isAllCaps = false
        b.setOnClickListener { acao() }
        val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        lp.topMargin = dp(6)
        corpo.addView(b, lp)
        return b
    }

    private fun abrir(i: Intent): Boolean {
        return try {
            startActivity(i)
            true
        } catch (e: Exception) {
            false
        }
    }

    /** Abre o Financ (site/PWA) no Chrome; sem Chrome, no navegador padrão. */
    private fun abrirSite(url: String) {
        val i = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)
        if (!abrir(Intent(i).setPackage("com.android.chrome")) && !abrir(i)) {
            Toast.makeText(this, "Abra $url no navegador", Toast.LENGTH_LONG).show()
        }
    }

    private fun detalhesDoApp() {
        if (!abrir(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))) {
            Toast.makeText(this, "Abra Configurações > Apps > Financ", Toast.LENGTH_LONG).show()
        }
    }

    private fun acessoPermitido(): Boolean =
        NotificationManagerCompat.getEnabledListenerPackages(this).contains(packageName)

    private fun montar() {
        corpo.removeAllViews()
        texto("Captura de notificações", 22f, true, Color.parseColor("#0F2A4A"), 0)
        nota("O Financ lê os avisos dos apps de banco deste aparelho e pergunta no WhatsApp se pode lançar. Nada é lançado sem o seu sim. Só segue o que fala de valor (R\$); códigos e senhas são ignorados.")

        // 1) acesso às notificações
        val acesso = acessoPermitido()
        secao("1. Acesso às notificações")
        texto(if (acesso) "✅ Permitido" else "❌ Ainda não permitido")
        botao("Abrir a permissão de notificações") {
            if (!abrir(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))) detalhesDoApp()
        }
        if (!acesso) {
            nota("Se o Financ aparecer bloqueado na lista (“configuração restrita”): toque em Informações do app, depois nos três pontos no alto e em Permitir configurações restritas. Volte e ative.")
            botao("Informações do app") { detalhesDoApp() }
        }

        // 2) pareamento
        secao("2. Pareamento com o Financ")
        val estado = Prefs.pareado(this)
        val situacao = texto(
            when (estado) {
                1 -> "✅ Pareado: o servidor aceita este aparelho"
                2 -> "❌ O servidor não reconhece este aparelho. Pareie de novo."
                else -> "Ainda não pareado"
            }
        )
        botao("Parear com o Financ") {
            // abre o Financ no Chrome; a chave vai no fragmento (#), que não aparece nos registros do servidor
            val url = BuildConfig.BASE_URL + "/#chave=" + Prefs.chave(this)
            abrirSite(url)
        }
        botao("Testar a conexão") {
            situacao.text = "Testando…"
            val ctx = applicationContext
            Thread {
                val msg = try {
                    val r = Api.postar(ctx, JSONObject().put("teste", true))
                    when {
                        r.codigo in 200..299 -> {
                            Prefs.definirPareado(ctx, 1)
                            EnvioWorker.agendar(ctx)
                            "✅ Pareado: o servidor aceita este aparelho"
                        }
                        r.codigo == 401 -> {
                            Prefs.definirPareado(ctx, 2)
                            "❌ O servidor não reconhece este aparelho. Toque em Parear com o Financ."
                        }
                        else -> "Servidor respondeu ${r.codigo}. Tente de novo em instantes."
                    }
                } catch (e: Exception) {
                    "Sem conexão com o servidor agora."
                }
                runOnUiThread { situacao.text = msg }
            }.start()
        }

        // 3) segundo plano
        secao("3. Manter funcionando em segundo plano")
        nota("Em celulares Xiaomi (HyperOS), sem estes dois ajustes o sistema encerra a leitura depois de um tempo.")
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        val livre = pm.isIgnoringBatteryOptimizations(packageName)
        texto(if (livre) "✅ Bateria sem restrições" else "❌ Bateria com restrição")
        if (!livre) {
            botao("Tirar a restrição de bateria") {
                if (!abrir(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))) detalhesDoApp()
            }
        }
        botao("Início automático (Xiaomi)") {
            val i = Intent().setComponent(ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"))
            if (!abrir(i)) detalhesDoApp()
        }

        // apps monitorados
        secao("Apps monitorados")
        nota("Um pacote por linha. O Nubank (contas PF e PJ) é com.nu.production.")
        val campo = EditText(this)
        campo.setText(Prefs.appsTexto(this))
        campo.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        campo.minLines = 2
        campo.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        corpo.addView(campo)
        botao("Salvar apps") {
            Prefs.salvarApps(this, campo.text.toString())
            Toast.makeText(this, "Apps salvos", Toast.LENGTH_SHORT).show()
            montar()
        }
        val monitorados = Prefs.apps(this)
        val outros = Prefs.vistos(this).filter { !monitorados.contains(it) }.take(8)
        if (outros.isNotEmpty()) {
            nota("Notificaram há pouco (toque para adicionar):")
            for (pacote in outros) {
                val t = texto("+ " + NotifService.rotulo(this, pacote) + "  (" + pacote + ")", 14f, false, Color.parseColor("#185FA5"), 8)
                t.setOnClickListener {
                    Prefs.salvarApps(this, Prefs.appsTexto(this) + "\n" + pacote)
                    montar()
                }
            }
        }

        // situação
        secao("Situação")
        texto("Na fila para enviar: " + Fila.tamanho(this))
        val ultimas = Prefs.capturas(this)
        if (ultimas.isEmpty()) nota("Nenhuma captura ainda. Depois de uma compra ou Pix, ela aparece aqui.")
        else for (linha in ultimas) nota(linha)

        val espaco = View(this)
        corpo.addView(espaco, LinearLayout.LayoutParams(1, dp(14)))
        botao("Abrir o Financ") { abrirSite(BuildConfig.BASE_URL + "/") }
    }
}
