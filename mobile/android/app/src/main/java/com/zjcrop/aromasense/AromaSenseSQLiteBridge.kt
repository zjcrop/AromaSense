package com.zjcrop.aromasense

import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject

class AromaSenseSQLiteBridge(private val database: SQLiteDatabase) {
    private var transactionDepth = 0

    private fun ok(value: Any? = null): String = JSONObject().apply {
        put("ok", true)
        if (value != null) put("value", value)
    }.toString()

    private fun fail(error: Throwable): String = JSONObject().apply {
        put("ok", false)
        put("error", error.message ?: error.javaClass.simpleName)
    }.toString()

    private fun params(json: String): JSONArray = JSONArray(json)

    private fun bind(statement: android.database.sqlite.SQLiteStatement, values: JSONArray) {
        for (index in 0 until values.length()) {
            val position = index + 1
            val value = values.opt(index)
            when (value) {
                null, JSONObject.NULL -> statement.bindNull(position)
                is Int -> statement.bindLong(position, value.toLong())
                is Long -> statement.bindLong(position, value)
                is Double -> statement.bindDouble(position, value)
                is Boolean -> statement.bindLong(position, if (value) 1 else 0)
                else -> statement.bindString(position, value.toString())
            }
        }
    }

    private fun selectionArgs(values: JSONArray): Array<String> = Array(values.length()) { index ->
        val value = values.opt(index)
        if (value == null || value == JSONObject.NULL) "" else value.toString()
    }

    private fun cursorRow(cursor: Cursor): JSONObject = JSONObject().apply {
        for (index in 0 until cursor.columnCount) {
            val name = cursor.getColumnName(index)
            when (cursor.getType(index)) {
                Cursor.FIELD_TYPE_NULL -> put(name, JSONObject.NULL)
                Cursor.FIELD_TYPE_INTEGER -> put(name, cursor.getLong(index))
                Cursor.FIELD_TYPE_FLOAT -> put(name, cursor.getDouble(index))
                Cursor.FIELD_TYPE_BLOB -> put(name, android.util.Base64.encodeToString(cursor.getBlob(index), android.util.Base64.NO_WRAP))
                else -> put(name, cursor.getString(index))
            }
        }
    }

    @JavascriptInterface
    fun exec(sql: String): String = try {
        sql.lineSequence()
            .filterNot { it.trimStart().startsWith("--") }
            .joinToString("\n")
            .split(';')
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .forEach { database.execSQL(it) }
        ok()
    } catch (error: Throwable) { fail(error) }

    @JavascriptInterface
    fun run(sql: String, paramsJson: String): String = try {
        val statement = database.compileStatement(sql)
        bind(statement, params(paramsJson))
        statement.execute()
        statement.close()
        ok()
    } catch (error: Throwable) { fail(error) }

    @JavascriptInterface
    fun get(sql: String, paramsJson: String): String = try {
        database.rawQuery(sql, selectionArgs(params(paramsJson))).use { cursor ->
            ok(if (cursor.moveToFirst()) cursorRow(cursor) else JSONObject.NULL)
        }
    } catch (error: Throwable) { fail(error) }

    @JavascriptInterface
    fun all(sql: String, paramsJson: String): String = try {
        database.rawQuery(sql, selectionArgs(params(paramsJson))).use { cursor ->
            val rows = JSONArray()
            while (cursor.moveToNext()) rows.put(cursorRow(cursor))
            ok(rows)
        }
    } catch (error: Throwable) { fail(error) }

    @JavascriptInterface
    fun begin(): String = try {
        if (transactionDepth != 0) error("TRANSACTION_ALREADY_ACTIVE")
        database.beginTransaction()
        transactionDepth = 1
        ok()
    } catch (error: Throwable) { fail(error) }

    @JavascriptInterface
    fun commit(): String = try {
        if (transactionDepth != 1) error("NO_TOP_LEVEL_TRANSACTION")
        database.setTransactionSuccessful()
        database.endTransaction()
        transactionDepth = 0
        ok()
    } catch (error: Throwable) { fail(error) }

    @JavascriptInterface
    fun rollback(): String = try {
        if (transactionDepth > 0) database.endTransaction()
        transactionDepth = 0
        ok()
    } catch (error: Throwable) { fail(error) }

    @JavascriptInterface
    fun savepoint(name: String): String = try {
        database.execSQL("SAVEPOINT $name")
        transactionDepth += 1
        ok()
    } catch (error: Throwable) { fail(error) }

    @JavascriptInterface
    fun release(name: String): String = try {
        database.execSQL("RELEASE SAVEPOINT $name")
        transactionDepth = (transactionDepth - 1).coerceAtLeast(0)
        ok()
    } catch (error: Throwable) { fail(error) }

    @JavascriptInterface
    fun rollbackTo(name: String): String = try {
        database.execSQL("ROLLBACK TO SAVEPOINT $name")
        ok()
    } catch (error: Throwable) { fail(error) }
}
