package `in`.uxcommunity.app

import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Process
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Android chat pushes, drawn by the app.
 *
 * Expo's push transport sends a `notification` payload, which Android's system
 * renderer displays before app code runs — its layout cannot become a
 * WhatsApp-style conversation with the community DP in the avatar slot. The
 * server therefore sends chat messages as data-only FCM messages
 * (`direct=1`); this service builds the notification itself.
 *
 * Every other message (Expo pushes, foreground chat) is handed to the Expo
 * service unchanged: `super.onMessageReceived` keeps DM/activity/event pushes
 * working exactly as before, and the JS notification handler keeps its
 * "don't notify the chat you're reading" rule in the foreground.
 */
class ChatFirebaseMessagingService : ExpoFirebaseMessagingService() {
  companion object {
    private const val CHANNEL_AUDIBLE = "messages"
    private const val CHANNEL_SILENT = "messages-silent"

    /** Only the direct transport carries these; Expo pushes never do. */
    private const val DIRECT_KEY = "direct"
  }

  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val data = remoteMessage.data
    val communityId = data["communityId"]
    val isDirectChat =
      data[DIRECT_KEY] == "1" && data["type"] == "community_message" && !communityId.isNullOrBlank()

    if (!isDirectChat) {
      // Expo pushes (DMs, activity, events) keep their existing path.
      super.onMessageReceived(remoteMessage)
      return
    }

    // The chat already on screen gets no notification. The pref is written by
    // JS when a community screen mounts and cleared when it leaves; the
    // foreground check keeps a stale value from suppressing while backgrounded.
    if (isAppInForeground() && communityId == activeCommunityId()) return

    thread(name = "uxcommunity-chat-notification") {
      try {
        postChatNotification(data)
      } catch (_: Exception) {
        // A notification must never crash the FCM service. The message row is
        // already durable and the app catches up when opened.
      }
    }
  }

  private fun activeCommunityId(): String? {
    return try {
      getSharedPreferences(ChatNotificationStateModule.PREFS, Context.MODE_PRIVATE)
        .getString(ChatNotificationStateModule.ACTIVE_COMMUNITY_KEY, null)
    } catch (_: Exception) {
      null
    }
  }

  private fun isAppInForeground(): Boolean {
    return try {
      val manager = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      manager.runningAppProcesses?.any {
        it.pid == Process.myPid() &&
          it.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
      } == true
    } catch (_: Exception) {
      false
    }
  }

  private fun postChatNotification(data: Map<String, String>) {
    val context = applicationContext
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return

    val communityId = data["communityId"] ?: return
    val communityName = data["communityName"] ?: data["title"] ?: "New message"
    val senderName = data["senderName"] ?: "Someone"
    val messageText = data["message"].takeUnless { it.isNullOrBlank() } ?: "Sent a message"
    val imageUrl = data["imageUrl"]
    val silent = data["silent"] == "1"
    val badge = data["badge"]?.toIntOrNull()
    val timestamp = data["timestamp"]?.toLongOrNull() ?: System.currentTimeMillis()

    ensureChannels(context)

    val avatar = imageUrl?.let { download(it) }
    val avatarIcon = avatar?.let { IconCompat.createWithBitmap(it) }
    val communityPerson = Person.Builder()
      .setName(communityName)
      .apply { if (avatarIcon != null) setIcon(avatarIcon) }
      .build()
    val senderPerson = Person.Builder()
      .setName(senderName)
      .apply { if (avatarIcon != null) setIcon(avatarIcon) }
      .build()

    val deepLink = Uri.parse("uxcommunity:///community/$communityId")
    val contentIntent = Intent(Intent.ACTION_VIEW, deepLink, context, MainActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val pendingIntent = PendingIntent.getActivity(
      context,
      communityId.hashCode(),
      contentIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val builder = NotificationCompat.Builder(
      context,
      if (silent) CHANNEL_SILENT else CHANNEL_AUDIBLE,
    )
      .setSmallIcon(R.drawable.notification_icon)
      .setColor(ContextCompat.getColor(context, R.color.notification_icon_color))
      .setContentTitle(communityName)
      .setContentText("$senderName: $messageText")
      .setStyle(
        NotificationCompat.MessagingStyle(Person.Builder().setName("You").build())
          .setConversationTitle(communityName)
          .addMessage(messageText, timestamp, senderPerson),
      )
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setAutoCancel(true)
      .setOnlyAlertOnce(silent)
      .setContentIntent(pendingIntent)

    if (avatar != null) builder.setLargeIcon(avatar)
    if (badge != null && badge > 0) builder.setNumber(badge)

    // Conversation notifications take their avatar from a long-lived shortcut.
    // If the shortcut cannot be published (limit, OEM policy) the notification
    // still shows the DP as its large icon.
    val shortcutId = "community-$communityId"
    if (avatarIcon != null) {
      try {
        val shortcut = ShortcutInfoCompat.Builder(context, shortcutId)
          .setShortLabel(communityName.take(40))
          .setLongLabel(communityName)
          .setIcon(avatarIcon)
          .setPerson(communityPerson)
          .setLongLived(true)
          .setCategories(setOf("android.shortcut.conversation"))
          .setIntent(contentIntent)
          .build()
        ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)
        builder.setShortcutId(shortcutId)
      } catch (_: Exception) {
        // Best effort; the large icon is still the community DP.
      }
    }

    NotificationManagerCompat.from(context).notify(
      communityId.hashCode(),
      builder.build(),
    )
  }

  private fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val color = ContextCompat.getColor(context, R.color.notification_icon_color)

    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_AUDIBLE, "Messages", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "New messages in your communities"
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 250, 250, 250)
        lightColor = color
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      },
    )
    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL_SILENT,
        "Quiet message updates",
        NotificationManager.IMPORTANCE_DEFAULT,
      ).apply {
        description = "Updates to a chat you already have a notification for"
        setSound(null, null)
        enableVibration(false)
        lightColor = color
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      },
    )
  }

  /** Small, bounded fetch; a failed avatar just means no large icon. */
  private fun download(imageUrl: String): Bitmap? {
    return try {
      val connection = URL(imageUrl).openConnection() as HttpURLConnection
      connection.connectTimeout = 5_000
      connection.readTimeout = 5_000
      connection.instanceFollowRedirects = true
      try {
        if (connection.responseCode !in 200..299) return null
        connection.inputStream.use { BitmapFactory.decodeStream(it) }
      } finally {
        connection.disconnect()
      }
    } catch (_: Exception) {
      null
    }
  }
}
