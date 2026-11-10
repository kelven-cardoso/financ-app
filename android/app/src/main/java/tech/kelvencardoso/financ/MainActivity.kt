package tech.kelvencardoso.financ

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import com.google.androidbrowserhelper.trusted.LauncherActivity

/** Ícone do app: na primeira vez mostra a configuração da captura; depois abre direto o Financ. */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val destino = if (Prefs.configurado(this)) LauncherActivity::class.java else ConfigActivity::class.java
        startActivity(Intent(this, destino))
        finish()
    }
}
