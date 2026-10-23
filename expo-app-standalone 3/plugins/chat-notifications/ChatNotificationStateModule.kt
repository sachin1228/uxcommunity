package `in`.uxcommunity.app

import android.content.Context
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

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

  override fun getName(): String = "ChatNotificationState"

  @ReactMethod
  fun setActiveCommunity(communityId: String?) {
    reactApplicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(ACTIVE_COMMUNITY_KEY, communityId)
      .apply()
  }

  companion object {
    const val PREFS = "chat_notifications"
    const val ACTIVE_COMMUNITY_KEY = "active_community"
  }
}
