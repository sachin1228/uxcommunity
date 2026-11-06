package `in`.uxcommunity.app

import android.content.Context
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.lang.ref.WeakReference
import org.json.JSONArray
import org.json.JSONObject

/**
 * The one piece of screen state the FCM service needs: which community chat
 * the member is currently reading. JS sets it on the chat screen and clears it
 * on leave; ChatFirebaseMessagingService suppresses that one chat's
 * notification, so custom-rendered notifications can be used in the foreground
 * without pinging the member about the messages already on their screen.
 */
class ChatNotificationStateModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  init { contextRef = WeakReference(reactContext) }

  override fun getName(): String = "ChatNotificationState"

  @ReactMethod
  fun setCurrentUser(userId: String?) {
    synchronized(PENDING_LOCK) {
      val prefs = reactApplicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val editor = prefs.edit().putString(USER_KEY, userId)
      if (prefs.getString(USER_KEY, null) != userId) editor.remove(PENDING_KEY)
      editor.apply()
    }
  }

  @ReactMethod
  fun consumePendingCommunities(userId: String, promise: Promise) {
    val result = Arguments.createArray()
    synchronized(PENDING_LOCK) {
      val prefs = reactApplicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      if (prefs.getString(USER_KEY, null) == userId) {
        val pending = try { JSONArray(prefs.getString(PENDING_KEY, "[]")) } catch (_: Exception) { JSONArray() }
        // Warm at most three targets on resume, rather than bursting one API
        // request per notification. A tapped chat always syncs independently.
        val remaining = JSONArray()
        for (index in 0 until pending.length()) {
          val item = pending.optJSONObject(index) ?: continue
          if (index < 3) {
            val hint = Arguments.createMap().apply {
              putString("userId", userId)
              putString("communityId", item.optString("communityId"))
              if (item.has("chatMessage")) putString("chatMessage", item.getString("chatMessage"))
            }
            result.pushMap(hint)
          } else remaining.put(item)
        }
        prefs.edit().putString(PENDING_KEY, remaining.toString()).apply()
      }
    }
    promise.resolve(result)
  }

  @ReactMethod
  fun setActiveCommunity(communityId: String?) {
    reactApplicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(ACTIVE_COMMUNITY_KEY, communityId)
      .apply()
  }

  @ReactMethod
  fun setActiveDmConversation(conversationId: String?) {
    reactApplicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(ACTIVE_DM_CONVERSATION_KEY, conversationId)
      .apply()
  }

  companion object {
    const val PREFS = "chat_notifications"
    const val ACTIVE_COMMUNITY_KEY = "active_community"
    const val ACTIVE_DM_CONVERSATION_KEY = "active_dm_conversation"
    private const val USER_KEY = "message_cache_user"
    private const val PENDING_KEY = "pending_communities"
    private val PENDING_LOCK = Any()
    private var contextRef: WeakReference<ReactApplicationContext>? = null

    /**
     * The member JS last marked as signed in, or null after sign-out.
     *
     * The FCM service runs without JS, so this prefs value is the native
     * session gate: when it is null, a push that still reaches the device (for
     * example after a revoked session before the server token deletion settles)
     * is dropped instead of displaying the previous account's message.
     */
    fun currentUserId(context: Context): String? {
      return try {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
          .getString(USER_KEY, null)
      } catch (_: Exception) {
        null
      }
    }

    fun recordCommunityMessage(context: Context, communityId: String, data: Map<String, String>) {
      val userId: String
      val snapshot = data["chatMessage"]?.takeIf { it.toByteArray(Charsets.UTF_8).size <= 2_000 }
      synchronized(PENDING_LOCK) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        userId = prefs.getString(USER_KEY, null) ?: return
        if (data["recipientId"] != null && data["recipientId"] != userId) return
        val pending = try { JSONArray(prefs.getString(PENDING_KEY, "[]")) } catch (_: Exception) { JSONArray() }
        val item = JSONObject().put("communityId", communityId)
        if (snapshot != null) item.put("chatMessage", snapshot)
        val next = JSONArray().put(item)
        for (index in 0 until pending.length()) {
          val previous = pending.optJSONObject(index) ?: continue
          if (previous.optString("communityId") != communityId && next.length() < 40) next.put(previous)
        }
        prefs.edit().putString(PENDING_KEY, next.toString()).apply()
      }
      val reactContext = contextRef?.get()
      if (reactContext?.hasActiveReactInstance() == true) {
        val hint = Arguments.createMap().apply {
          putString("userId", userId)
          putString("communityId", communityId)
          if (snapshot != null) putString("chatMessage", snapshot)
        }
        reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("community-message-received", hint)
      }
    }
  }
}
