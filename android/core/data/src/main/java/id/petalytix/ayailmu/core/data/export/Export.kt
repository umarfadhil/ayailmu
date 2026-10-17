package id.petalytix.ayailmu.core.data.export

import android.content.Context
import android.net.Uri
import androidx.core.content.FileProvider
import id.petalytix.ayailmu.core.content.ContentJson
import id.petalytix.ayailmu.core.data.ItemReport
import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.model.AnswerEvent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File

/**
 * Learning-data export (CR-DAT-4; replaces the trial spec's upload, PROJECT_OVERVIEW "Spec deviations").
 * Profiles are exported without label or birth year: the team needs ids, kind, audience and language only.
 */
object ExportBuilder {
    const val SCHEMA_VERSION = 1

    @Serializable
    data class ExportProfile(
        val id: String,
        val kind: String,
        val audience: String,
        val lang: String,
        @SerialName("created_at_ms") val createdAtMs: Long,
    )

    @Serializable
    data class ExportReport(
        @SerialName("report_id") val reportId: String,
        @SerialName("profile_id") val profileId: String,
        @SerialName("item_id") val itemId: String,
        @SerialName("content_version") val contentVersion: String,
        val timestamp: String,
        val reason: String,
        val text: String,
    )

    @Serializable
    data class ExportDoc(
        @SerialName("schema_version") val schemaVersion: Int,
        @SerialName("exported_at") val exportedAt: String,
        @SerialName("app_version") val appVersion: String,
        val profiles: List<ExportProfile>,
        val events: List<AnswerEvent>,
        val reports: List<ExportReport>,
    )

    data class Bundle(
        val json: String,
        val csv: String,
    )

    private val pretty = Json(from = ContentJson.json) { prettyPrint = true }

    val CSV_COLUMNS =
        listOf(
            "answer_id", "learner_id", "item_id", "track", "content_version", "rules_version", "app_version",
            "timestamp", "local_date", "session_id", "lang", "pool", "unit", "item_type", "skills", "outcome",
            "auto_score", "error_tags", "serious_tag", "hint_used", "first_attempt", "fresh_evidence",
            "time_on_item_ms", "audio_status", "gem", "review_status", "synthetic", "raw_response",
        )

    fun build(
        profiles: List<Profile>,
        events: List<AnswerEvent>,
        reports: List<ItemReport>,
        exportedAt: String,
        appVersion: String,
    ): Bundle {
        val doc =
            ExportDoc(
                schemaVersion = SCHEMA_VERSION,
                exportedAt = exportedAt,
                appVersion = appVersion,
                profiles = profiles.map { ExportProfile(it.id, it.kind.name, it.audience.name, it.lang.tag, it.createdAtMs) },
                events = events,
                reports = reports.map { ExportReport(it.reportId, it.profileId, it.itemId, it.contentVersion, it.timestamp, it.reason, it.text) },
            )
        return Bundle(json = pretty.encodeToString(ExportDoc.serializer(), doc), csv = csv(events))
    }

    /** One row per answer event; UTF-8 with BOM so spreadsheet apps show Arabic and Indonesian correctly. */
    fun csv(events: List<AnswerEvent>): String {
        val sb = StringBuilder("﻿")
        sb.append(CSV_COLUMNS.joinToString(",")).append("\r\n")
        for (e in events) {
            val row =
                listOf(
                    e.answerId, e.learnerId, e.itemId, e.track, e.contentVersion, e.rulesVersion, e.appVersion,
                    e.timestamp, e.localDate, e.sessionId, e.lang.tag, e.pool.name, e.unit, e.itemType.name,
                    e.skills.joinToString("|"), e.outcome.name,
                    e.autoScore.entries.joinToString("|") { "${it.key}=${it.value.name}" },
                    e.errorTags.joinToString("|") { it.name }, e.seriousTag?.name.orEmpty(),
                    e.hintUsed.toString(), e.firstAttempt.toString(), e.freshEvidence.toString(),
                    e.timeOnItemMs.toString(), e.audioStatus?.name.orEmpty(), e.gem.toString(),
                    e.reviewStatus.name, e.synthetic.toString(), e.rawResponse,
                )
            sb.append(row.joinToString(",") { cell(it) }).append("\r\n")
        }
        return sb.toString()
    }

    /** RFC 4180 quoting, plus a leading apostrophe on formula-like text so a spreadsheet never executes it. */
    fun cell(raw: String): String {
        val safe = if (raw.isNotEmpty() && raw[0] in "=+-@\t\r") "'$raw" else raw
        val needsQuotes = safe.any { it == ',' || it == '"' || it == '\n' || it == '\r' }
        return if (needsQuotes) "\"" + safe.replace("\"", "\"\"") + "\"" else safe
    }
}

/** Writes an export bundle to cache/exports and returns content URIs for the share sheet. */
object ExportFiles {
    const val DIR = "exports"

    fun authority(context: Context): String = context.packageName + ".exports"

    suspend fun write(
        context: Context,
        bundle: ExportBuilder.Bundle,
        stamp: String,
    ): List<Uri> =
        withContext(Dispatchers.IO) {
            val dir = File(context.cacheDir, DIR).apply { mkdirs() }
            dir.listFiles()?.forEach { it.delete() }
            val json = File(dir, "ayailmu-export-$stamp.json").apply { writeText(bundle.json) }
            val csv = File(dir, "ayailmu-export-$stamp.csv").apply { writeText(bundle.csv) }
            listOf(json, csv).map { FileProvider.getUriForFile(context, authority(context), it) }
        }

    fun clear(context: Context) {
        File(context.cacheDir, DIR).deleteRecursively()
    }
}
