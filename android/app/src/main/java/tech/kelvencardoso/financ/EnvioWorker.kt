package tech.kelvencardoso.financ

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** Esvazia a fila quando há internet; se falhar, o sistema tenta de novo sozinho (com espera crescente). */
class EnvioWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    override fun doWork(): Result {
        val c = applicationContext
        val itens = Fila.ler(c)
        for (i in 0 until itens.length()) {
            val o = itens.optJSONObject(i) ?: continue
            val id = o.optString("id")
            val r = try {
                Api.postar(c, o)
            } catch (e: Exception) {
                return Result.retry()
            }
            when {
                r.codigo in 200..299 -> {
                    Fila.remover(c, id)
                    Prefs.definirPareado(c, 1)
                }
                r.codigo == 401 -> {
                    // chave não pareada (ou trocada): guarda a fila e tenta mais tarde
                    Prefs.definirPareado(c, 2)
                    return Result.retry()
                }
                r.codigo == 400 || r.codigo == 413 || r.codigo == 422 -> Fila.remover(c, id) // item inválido: não insiste
                else -> return Result.retry()
            }
        }
        return Result.success()
    }

    companion object {
        fun agendar(c: Context) {
            val req = OneTimeWorkRequest.Builder(EnvioWorker::class.java)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(c.applicationContext)
                .enqueueUniqueWork("envio", ExistingWorkPolicy.APPEND_OR_REPLACE, req)
        }
    }
}
