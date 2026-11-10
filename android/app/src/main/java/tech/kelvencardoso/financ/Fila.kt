package tech.kelvencardoso.financ

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Fila em arquivo: o que foi capturado espera aqui até o servidor confirmar o recebimento. */
object Fila {
    private const val ARQUIVO = "fila.json"
    private const val MAX = 300

    @Synchronized
    fun ler(c: Context): JSONArray {
        val f = File(c.filesDir, ARQUIVO)
        if (!f.exists()) return JSONArray()
        return try {
            JSONArray(f.readText())
        } catch (e: Exception) {
            JSONArray()
        }
    }

    private fun gravar(c: Context, a: JSONArray) {
        File(c.filesDir, ARQUIVO).writeText(a.toString())
    }

    @Synchronized
    fun adicionar(c: Context, o: JSONObject) {
        val a = ler(c)
        val n = JSONArray()
        val inicio = if (a.length() >= MAX) a.length() - MAX + 1 else 0
        for (i in inicio until a.length()) n.put(a.get(i))
        n.put(o)
        gravar(c, n)
    }

    @Synchronized
    fun remover(c: Context, id: String) {
        val a = ler(c)
        val n = JSONArray()
        for (i in 0 until a.length()) {
            val o = a.optJSONObject(i) ?: continue
            if (o.optString("id") != id) n.put(o)
        }
        gravar(c, n)
    }

    fun tamanho(c: Context): Int = ler(c).length()
}
