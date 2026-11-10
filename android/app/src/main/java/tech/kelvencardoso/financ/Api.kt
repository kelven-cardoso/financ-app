package tech.kelvencardoso.financ

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Envio para o servidor do Financ (mesmo domínio do app), autenticado pela chave deste aparelho. */
object Api {
    class Resposta(val codigo: Int, val corpo: String)

    fun postar(c: Context, json: JSONObject): Resposta {
        val con = URL(BuildConfig.BASE_URL + "/api/captura/notificacao").openConnection() as HttpURLConnection
        try {
            con.requestMethod = "POST"
            con.connectTimeout = 15000
            con.readTimeout = 20000
            con.doOutput = true
            con.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            con.setRequestProperty("x-financ", "1")
            con.setRequestProperty("x-financ-chave", Prefs.chave(c))
            con.outputStream.use { it.write(json.toString().toByteArray(Charsets.UTF_8)) }
            val codigo = con.responseCode
            val corpo = try {
                val s = if (codigo in 200..299) con.inputStream else con.errorStream
                s?.bufferedReader()?.use { it.readText() } ?: ""
            } catch (e: Exception) {
                ""
            }
            return Resposta(codigo, corpo)
        } finally {
            con.disconnect()
        }
    }
}
