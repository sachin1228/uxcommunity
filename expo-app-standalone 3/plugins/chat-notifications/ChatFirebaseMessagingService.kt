package `in`.uxcommunity.app

import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Shader
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Process
import android.util.LruCache
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
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * Android chat pushes, drawn by the app.
 *
 * Expo's push transport sends a `notification` payload, which Android's system
 * renderer displays before app code runs — its layout cannot become a
 * WhatsApp-style conversation with the sender's profile picture in the avatar slot. The
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

    /** Decoded conversation avatars kept across pushes (one per conversation). */
    private const val AVATAR_CACHE_ENTRIES = 12
    private val avatarCache = LruCache<String, Bitmap>(AVATAR_CACHE_ENTRIES)

    /** The square every avatar bitmap is drawn into, in pixels. */
    private const val AVATAR_SIZE = 192

    /**
     * Rows a conversation notification keeps. A push carries one message, so
     * each post appends its own row to the rows already in the shade; the
     * oldest fall off after this many, matching the platform's MessagingStyle
     * ceiling without dumping an entire backlog into the notification.
     */
    private const val MAX_MESSAGES = 5

    /**
     * Notification work runs one push at a time. Every post reads the
     * conversation's currently posted MessagingStyle to append to its history;
     * two pushes racing would each read the same rows and one would be lost.
     *
     * The worker times out once the bursts stop: an idle non-daemon thread
     * would keep the FCM process resident long after the last notification.
     */
    private val notificationExecutor = ThreadPoolExecutor(
      1,
      1,
      30L,
      TimeUnit.SECONDS,
      LinkedBlockingQueue(),
    ) { runnable -> Thread(runnable, "uxcommunity-chat-notification") }
      .apply { allowCoreThreadTimeOut(true) }

    /**
     * What was last published for each conversation shortcut. Separate from
     * [ChatNotificationStateModule.PREFS], which JS owns and writes on screen
     * focus — nothing here may race with that.
     */
    private const val SHORTCUT_PREFS = "uxcommunity_notification_shortcuts"

    /**
     * Byte-identical to the Google-palette list in apps/web/lib/avatar.ts.
     * Server payloads carry the resolved sender colour; this copy is the
     * fallback for payloads that predate it, so an initials avatar is never
     * drawn in the community's colour.
     */
    private val AVATAR_BACKGROUNDS = arrayOf(
      "#1a73e8", "#d93025", "#188038", "#b06000", "#9334e6", "#00838f",
      "#c5221f", "#3949ab", "#ad1457", "#00695c", "#6a1b9a", "#455a64",
    )
  }

  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val data = remoteMessage.data
    val communityId = data["communityId"]
    val conversationId = data["conversationId"]
    val direct = data[DIRECT_KEY] == "1"
    val mode = when {
      direct && data["type"] == "community_message" && !communityId.isNullOrBlank() -> "community"
      direct && data["type"] == "dm_message" && !conversationId.isNullOrBlank() -> "dm"
      direct && data["type"] == "app_notification" && !data["notificationId"].isNullOrBlank() -> "activity"
      else -> null
    }

    if (mode == null) {
      // Expo pushes (older builds, iOS-only paths) keep their existing path.
      super.onMessageReceived(remoteMessage)
      return
    }

    // The conversation already on screen gets no notification. The prefs are
    // written by JS when the screen is focused and cleared when it leaves; the
    // foreground check keeps a stale value from suppressing while backgrounded.
    if (isAppInForeground()) {
      if (mode == "community" && communityId == activeCommunityId()) return
      if (mode == "dm" && conversationId == activeDmConversationId()) return
    }

    notificationExecutor.execute {
      try {
        postDirectNotification(data, mode)
      } catch (_: Exception) {
        // A notification must never crash the FCM service. The message row is
        // already durable and the app catches up when opened.
      }
    }
  }

  private fun activeCommunityId(): String? {
    return readState(ChatNotificationStateModule.ACTIVE_COMMUNITY_KEY)
  }

  private fun activeDmConversationId(): String? {
    return readState(ChatNotificationStateModule.ACTIVE_DM_CONVERSATION_KEY)
  }

  private fun readState(key: String): String? {
    return try {
      getSharedPreferences(ChatNotificationStateModule.PREFS, Context.MODE_PRIVATE)
        .getString(key, null)
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

  private fun postDirectNotification(data: Map<String, String>, mode: String) {
    val context = applicationContext
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return

    val conversationId = data["conversationId"]
    val communityId = data["communityId"]
    val notificationId = data["notificationId"]
    val personName = data["personName"] ?: "uxcommunity"
    val senderName = data["senderName"] ?: personName
    val title = when (mode) {
      "dm" -> data["title"].takeUnless { it.isNullOrBlank() } ?: senderName
      "activity" -> data["title"].takeUnless { it.isNullOrBlank() } ?: "uxcommunity"
      else -> data["communityName"] ?: data["title"] ?: "New message"
    }
    val messageText = when (mode) {
      "activity" -> (data["body"] ?: data["message"]).takeUnless { it.isNullOrBlank() } ?: "New activity"
      else -> data["message"].takeUnless { it.isNullOrBlank() } ?: "Sent a message"
    }
    val imageUrl = data["imageUrl"]
    val silent = data["silent"] == "1"
    val badge = data["badge"]?.toIntOrNull()
    val timestamp = data["timestamp"]?.toLongOrNull() ?: System.currentTimeMillis()

    // The identity used for the notification id, the shortcut and the collapse
    // slot: one per community, one per DM, one per activity row.
    val conversationKey = when (mode) {
      "dm" -> "dm-${conversationId ?: return}"
      "activity" -> "activity-${notificationId ?: return}"
      else -> "community-${communityId ?: return}"
    }
    val deepLinkPath = when (mode) {
      "dm" -> "messages/$conversationId"
      "activity" -> activityDeepLink(data["href"])
      else -> "community/$communityId"
    }
    val messagePerson = if (mode == "activity") personName else senderName

    ensureChannels(context)

    // Two identities meet in a chat notification: the conversation on the left
    // (the community's DP, or the DM peer) and the member who spoke on the
    // message row. In a DM the payload carries the same URL for both slots, so
    // the picture is fetched once; only the community layout has two images.
    val conversationUrl = imageUrl?.takeUnless { it.isNullOrBlank() }
    val senderUrl = data["senderAvatarUrl"]?.takeUnless { it.isNullOrBlank() }
    val conversationPhoto = conversationUrl?.let { downloadCached(it) }
    val senderPhoto = when {
      senderUrl == null -> null
      senderUrl == conversationUrl -> conversationPhoto
      else -> downloadCached(senderUrl)
    }
    val conversationAvatar = conversationPhoto ?: when {
      !data["avatarInitials"].isNullOrBlank() ->
        initialAvatar(data["avatarInitials"], data["avatarColor"], title)
      mode == "activity" ->
        emojiAvatar(data["icon"].takeUnless { it.isNullOrBlank() } ?: "🔔")
      else -> initialAvatar(null, data["avatarColor"], title)
    }
    val senderAvatar = if (mode == "activity") {
      // An activity row has one identity; the type glyph is its avatar.
      conversationAvatar
    } else {
      val senderColor = data["senderAvatarColor"] ?: avatarBackground(messagePerson)
      senderPhoto ?: initialAvatar(
        data["senderAvatarInitials"].takeUnless { it.isNullOrBlank() },
        senderColor,
        messagePerson,
      )
    }
    val conversationIcon = IconCompat.createWithBitmap(conversationAvatar)
    val senderIcon = IconCompat.createWithBitmap(senderAvatar)
    val conversationPerson = Person.Builder()
      .setName(title)
      .setIcon(conversationIcon)
      .build()
    val senderPerson = Person.Builder()
      .setName(messagePerson)
      .setIcon(senderIcon)
      .build()

    val deepLink = if (mode == "dm") {
      // The DM screen needs the peer snapshot to paint before its fetch; a
      // conversation id alone lands on the "Member" placeholder.
      Uri.parse("uxcommunity:///messages/${Uri.encode(conversationId)}").buildUpon()
        .appendQueryParameter("peerId", data["senderId"] ?: "")
        .appendQueryParameter("name", data["senderName"] ?: "")
        .appendQueryParameter("avatar", imageUrl ?: "")
        .build()
    } else {
      Uri.parse("uxcommunity:///$deepLinkPath")
    }
    val contentIntent = Intent(
      Intent.ACTION_VIEW,
      deepLink,
      context,
      MainActivity::class.java,
    ).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val pendingIntent = PendingIntent.getActivity(
      context,
      conversationKey.hashCode(),
      contentIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val newMessage = NotificationCompat.MessagingStyle.Message(messageText, timestamp, senderPerson)
    val messages = if (mode == "activity") {
      // An activity row is its own conversation; repeating it would just
      // duplicate the same row.
      listOf(newMessage)
    } else {
      (previousMessages(context, conversationKey).filterNot { it.sameAs(newMessage) } + newMessage)
        .sortedBy { it.timestamp }
        .takeLast(MAX_MESSAGES)
    }
    val style = NotificationCompat.MessagingStyle(Person.Builder().setName("You").build())
      .setConversationTitle(title)
      .setGroupConversation(mode == "community")
    for (message in messages) style.addMessage(message)

    val builder = NotificationCompat.Builder(
      context,
      if (silent) CHANNEL_SILENT else CHANNEL_AUDIBLE,
    )
      .setSmallIcon(R.drawable.notification_icon)
      .setColor(ContextCompat.getColor(context, R.color.notification_icon_color))
      .setContentTitle(title)
      .setContentText("$messagePerson: $messageText")
      .setStyle(style)
      .setCategory(
        if (mode == "activity") NotificationCompat.CATEGORY_SOCIAL
        else NotificationCompat.CATEGORY_MESSAGE,
      )
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setAutoCancel(true)
      .setOnlyAlertOnce(silent)
      .setContentIntent(pendingIntent)
      // The shade should show when the message was sent, not when this device
      // finished drawing it (the payload timestamp is the server's send time).
      .setWhen(timestamp)
      .setLargeIcon(conversationAvatar)

    if (badge != null && badge > 0) builder.setNumber(badge)

    // Conversation notifications take their avatar from a long-lived shortcut:
    // the shade draws that shortcut's person icon in the left slot, and no
    // notification API can place a picture there directly.
    //
    // Android rations shortcut publishes (a handful per day, per package), and
    // every push — including the second message of a conversation that already
    // has its shortcut — spends one. A busy chat therefore exhausts the quota
    // and every *new* conversation is drawn with the app icon instead of its
    // DP, with no error anywhere. Publishing only when what is drawn actually
    // changed keeps the quota for the conversations that need it.
    val avatarSignature = imageUrl
      ?: "init:${data["avatarInitials"] ?: ""}:${data["avatarColor"] ?: ""}:${data["icon"] ?: ""}"
    if (
      publishConversationShortcut(
        context = context,
        conversationKey = conversationKey,
        title = title,
        signature = "$title|$avatarSignature",
        icon = conversationIcon,
        person = conversationPerson,
        intent = contentIntent,
      )
    ) {
      builder.setShortcutId(conversationKey)
    }

    NotificationManagerCompat.from(context).notify(
      conversationKey.hashCode(),
      builder.build(),
    )
  }

  /**
   * The messages already on this conversation's notification, oldest first.
   *
   * A push carries one message, so the rows before it are read back from the
   * notification they were posted into — the shade is the only store. Reading
   * the live notification (rather than persisting a history) also means a
   * cleared conversation starts fresh with the next message, and rows the
   * member dismissed never reappear.
   */
  private fun previousMessages(
    context: Context,
    conversationKey: String,
  ): List<NotificationCompat.MessagingStyle.Message> {
    return try {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val posted = manager.activeNotifications.firstOrNull {
        it.id == conversationKey.hashCode() && it.tag == null
      }?.notification ?: return emptyList()
      val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(posted)
        ?: return emptyList()
      style.messages.mapNotNull { message ->
        val text = message.text?.toString() ?: return@mapNotNull null
        val name = message.person?.name?.toString() ?: return@mapNotNull null
        // Icons are dropped from history rows: the shade does not draw one per
        // message, and five parceled bitmaps would bloat the notification's
        // extras only to be discarded by the system.
        NotificationCompat.MessagingStyle.Message(
          text,
          message.timestamp,
          Person.Builder().setName(name).build(),
        )
      }
    } catch (_: Exception) {
      // A missing or unreadable notification simply means no history yet.
      emptyList()
    }
  }

  /** A repeated push (FCM delivery is at-least-once) must not add a row twice. */
  private fun NotificationCompat.MessagingStyle.Message.sameAs(
    other: NotificationCompat.MessagingStyle.Message,
  ): Boolean {
    return timestamp == other.timestamp &&
      text?.toString() == other.text?.toString() &&
      person?.name?.toString() == other.person?.name?.toString()
  }

  /**
   * Keeps the conversation's shortcut in step with what the shade draws, and
   * reports whether a shortcut with that id exists afterwards — the caller may
   * only name a shortcut it can actually point at.
   *
   * An unchanged conversation is a no-op: its published signature matches and
   * the shortcut is still installed. Everything else tries one publish, and a
   * refused publish (quota, OEM policy) is remembered as "not published" so a
   * later message retries instead of assuming the avatar is there.
   */
  private fun publishConversationShortcut(
    context: Context,
    conversationKey: String,
    title: String,
    signature: String,
    icon: IconCompat,
    person: Person,
    intent: Intent,
  ): Boolean {
    val prefs = shortcutPrefs(context)
    val key = shortcutSignatureKey(conversationKey)
    if (prefs.getString(key, null) == signature && shortcutExists(context, conversationKey)) {
      return true
    }

    return try {
      val shortcut = ShortcutInfoCompat.Builder(context, conversationKey)
        .setShortLabel(title.take(40))
        .setLongLabel(title)
        .setIcon(icon)
        .setPerson(person)
        .setLongLived(true)
        .setCategories(setOf("android.shortcut.conversation"))
        .setIntent(intent)
        .build()
      // The compat push reports whether the platform accepted it; the lookup
      // then proves the shortcut is really there, because a throttle silently
      // drops publishes on some builds instead of returning false.
      val pushed = ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)
      val available = shortcutExists(context, conversationKey)
      if (available) {
        // Only a publish that took effect is remembered as up to date, so a
        // refused update is retried on the next message instead of leaving a
        // stale avatar in place forever.
        val editor = prefs.edit()
        if (pushed) editor.putString(key, signature) else editor.remove(key)
        editor.apply()
      }
      // A shortcut that exists but could not be refreshed still carries the
      // conversation's previous DP — better than the app icon.
      available
    } catch (_: Exception) {
      false
    }
  }

  /** A notification must only name a shortcut the system can resolve. */
  private fun shortcutExists(context: Context, shortcutId: String): Boolean {
    return try {
      ShortcutManagerCompat.getShortcuts(context, ShortcutManagerCompat.FLAG_MATCH_DYNAMIC)
        .any { it.id == shortcutId }
    } catch (_: Exception) {
      false
    }
  }

  private fun shortcutPrefs(context: Context): SharedPreferences =
    context.getSharedPreferences(SHORTCUT_PREFS, Context.MODE_PRIVATE)

  private fun shortcutSignatureKey(conversationKey: String) = "signature:$conversationKey"

  private fun activityDeepLink(href: String?): String {
    val segments = href?.let { Uri.parse(it).pathSegments } ?: emptyList()
    val dashboard = segments.indexOf("dashboard")
    if (dashboard >= 0) {
      val section = segments.getOrNull(dashboard + 1)
      val id = segments.getOrNull(dashboard + 2)
      if (section == "communities" && !id.isNullOrBlank()) return "community/$id"
      if (section == "jobs" && !id.isNullOrBlank()) return "jobs/$id"
    }
    return "notifications"
  }

  /**
   * Bakes the avatar's circle into the bitmap.
   *
   * SystemUI masks notification icons into a circle on some Android releases
   * and draws a photo-shaped square on others — Android 14 shows the large
   * icon square when a conversation falls back to it — and nothing in the
   * notification API chooses the shape. Cropping here means the DP is round on
   * every release; everything outside the circle is transparent, so a system
   * that does mask it again finds no corners to remove.
   */
  private fun circularAvatar(source: Bitmap): Bitmap {
    val bitmap = Bitmap.createBitmap(AVATAR_SIZE, AVATAR_SIZE, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { isFilterBitmap = true }
    // Centre-crop the source's shorter edge, then draw it through a circle.
    val side = minOf(source.width, source.height).coerceAtLeast(1)
    val scale = AVATAR_SIZE.toFloat() / side
    val shader = BitmapShader(source, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP).apply {
      setLocalMatrix(
        Matrix().apply {
          setScale(scale, scale)
          postTranslate(
            (AVATAR_SIZE - source.width * scale) / 2f,
            (AVATAR_SIZE - source.height * scale) / 2f,
          )
        },
      )
    }
    paint.shader = shader
    canvas.drawCircle(AVATAR_SIZE / 2f, AVATAR_SIZE / 2f, AVATAR_SIZE / 2f, paint)
    return bitmap
  }

  private fun initialAvatar(
    initials: String?,
    colorHex: String?,
    fallbackName: String,
  ): Bitmap {
    val size = AVATAR_SIZE
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val backgroundColor = try {
      Color.parseColor(colorHex ?: "#1a73e8")
    } catch (_: Exception) {
      Color.parseColor("#1a73e8")
    }
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = backgroundColor }
    canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint)

    val text = initials?.takeUnless { it.isBlank() } ?: defaultInitials(fallbackName)
    val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE
      textSize = size * if (text.length > 1) 0.36f else 0.42f
      textAlign = Paint.Align.CENTER
      typeface = Typeface.DEFAULT_BOLD
    }
    val metrics = textPaint.fontMetrics
    canvas.drawText(
      text,
      size / 2f,
      size / 2f - (metrics.ascent + metrics.descent) / 2f,
      textPaint,
    )
    return bitmap
  }

  /** The app's nameInitials(): first letter of first and last words. */
  private fun defaultInitials(name: String): String {
    val words = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    if (words.isEmpty()) return "U"
    val first = words.first().firstOrNull()?.uppercaseChar() ?: 'U'
    val last = if (words.size > 1) words.last().firstOrNull()?.uppercaseChar() else null
    return buildString {
      append(first)
      if (last != null) append(last)
    }
  }

  /** The app's avatarBackground(): FNV-1a over the trimmed lowercase name. */
  private fun avatarBackground(name: String): String {
    var hash = 0x811c9dc5.toInt()
    for (char in name.trim().lowercase()) {
      hash = hash xor char.code
      hash *= 0x01000193
    }
    val unsigned = hash.toLong() and 0xFFFFFFFFL
    return AVATAR_BACKGROUNDS[(unsigned % AVATAR_BACKGROUNDS.size).toInt()]
  }

  private fun emojiAvatar(icon: String): Bitmap {
    val size = AVATAR_SIZE
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint)
    val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      textSize = size * 0.5f
      textAlign = Paint.Align.CENTER
      color = Color.BLACK
    }
    val metrics = textPaint.fontMetrics
    canvas.drawText(
      icon,
      size / 2f,
      size / 2f - (metrics.ascent + metrics.descent) / 2f,
      textPaint,
    )
    return bitmap
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

  /**
   * [download] with a small LRU in front of it.
   *
   * The service runs a thread per message and a busy conversation re-sends the
   * same sender's picture on every push; without this each notification paid a
   * fresh origin round trip (measured 0.4–0.6 s) before it could be drawn.
   */
  private fun downloadCached(imageUrl: String): Bitmap? {
    avatarCache.get(imageUrl)?.let { return it }
    val bitmap = download(imageUrl) ?: return null
    avatarCache.put(imageUrl, bitmap)
    return bitmap
  }

  /** Small, bounded fetch; a failed avatar just means no large icon. */
  private fun download(imageUrl: String): Bitmap? {
    return try {
      val connection = URL(imageUrl).openConnection() as HttpURLConnection
      // The notification waits on this: a slow origin must cost a placeholder
      // avatar, not seconds of an empty tray.
      connection.connectTimeout = 2_000
      connection.readTimeout = 2_000
      connection.instanceFollowRedirects = true
      try {
        if (connection.responseCode !in 200..299) return null
        connection.inputStream.use { stream ->
          val decoded = BitmapFactory.decodeStream(stream) ?: return null
          val avatar = circularAvatar(decoded)
          // The cache keeps the small circular copy, not the full-size photo.
          decoded.recycle()
          avatar
        }
      } finally {
        connection.disconnect()
      }
    } catch (_: Exception) {
      null
    }
  }
}
