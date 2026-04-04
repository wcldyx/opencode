package ai.opencode.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.pm.ServiceInfo;
import android.app.Service;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import android.util.Base64;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import org.json.JSONObject;
import org.json.JSONArray;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class KeepaliveService extends Service {
  private static final String TAG = "KeepaliveService";
  private static final String KEEPALIVE_CHANNEL = "opencode-keepalive";
  private static final String TASK_CHANNEL = "opencode-task";
  private static final int KEEPALIVE_ID = 4001;
  private static final long TRACK_GRACE_MS = 15_000;

  private static final Set<String> tracked = ConcurrentHashMap.newKeySet();
  private static final Set<String> seen = ConcurrentHashMap.newKeySet();
  private static final Map<String, Long> start = new ConcurrentHashMap<>();
  private static volatile String url;
  private static volatile String username;
  private static volatile String password;
  private static volatile boolean notify = true;
  private static volatile boolean active;

  private ScheduledExecutorService poller;

  public static void configure(String nextUrl, String nextUsername, String nextPassword, Boolean nextNotify) {
    if (url != null && nextUrl != null && !url.equals(nextUrl)) {
      tracked.clear();
      seen.clear();
      start.clear();
    }
    url = nextUrl;
    username = nextUsername;
    password = nextPassword;
    if (nextNotify != null) notify = nextNotify;
  }

  public static void setActive(boolean next) {
    active = next;
  }

  public static void setNotify(boolean next) {
    notify = next;
  }

  public static void track(String sessionID) {
    tracked.add(sessionID);
    start.put(sessionID, System.currentTimeMillis());
  }

  public static void untrack(String sessionID) {
    tracked.remove(sessionID);
    seen.remove(sessionID);
    start.remove(sessionID);
  }

  @Override
  public void onCreate() {
    super.onCreate();
    ensureChannels();
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    try {
      Log.d(TAG, "onStartCommand tracked=" + tracked.size() + " url=" + (url == null ? "" : url));
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        ServiceCompat.startForeground(
          this,
          KEEPALIVE_ID,
          keepaliveNotification(),
          ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        );
      } else {
        startForeground(KEEPALIVE_ID, keepaliveNotification());
      }

      if (poller == null || poller.isShutdown()) {
        poller = Executors.newSingleThreadScheduledExecutor();
        poller.scheduleWithFixedDelay(this::poll, 0, 3, TimeUnit.SECONDS);
      }

      return START_STICKY;
    } catch (Throwable err) {
      Log.e(TAG, "start failed", err);
      stopSelf();
      return START_NOT_STICKY;
    }
  }

  @Override
  public void onDestroy() {
    if (poller != null) {
      poller.shutdownNow();
      poller = null;
    }
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  private void poll() {
    if (url == null || url.isEmpty()) return;
    if (tracked.isEmpty()) return;

    try {
      JSONObject status = loadStatus();
      for (String sessionID : new HashSet<>(tracked)) {
        JSONObject item = status.optJSONObject(sessionID);
        if (item != null) {
          if (!"idle".equals(item.optString("type"))) {
            seen.add(sessionID);
            continue;
          }
          if (!completed(sessionID)) continue;
          finish(sessionID);
          continue;
        }

        if (!seen.contains(sessionID)) {
          long at = start.getOrDefault(sessionID, 0L);
          if (System.currentTimeMillis() - at < TRACK_GRACE_MS) continue;
        }

        if (!completed(sessionID)) continue;
        finish(sessionID);
      }
    } catch (Exception ignored) {
    }
  }

  private boolean completed(String sessionID) {
    try {
      String target = url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
      HttpURLConnection conn = (HttpURLConnection) new URL(target + "/session/" + sessionID + "/message?limit=1").openConnection();
      conn.setRequestMethod("GET");
      conn.setConnectTimeout(10_000);
      conn.setReadTimeout(10_000);
      conn.setRequestProperty("Accept", "application/json");

      if (password != null && !password.isEmpty()) {
        String user = username == null || username.isEmpty() ? "opencode" : username;
        String token = Base64.encodeToString((user + ":" + password).getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
        conn.setRequestProperty("Authorization", "Basic " + token);
      }

      String raw = read(conn.getResponseCode() >= 400 ? conn.getErrorStream() : conn.getInputStream());
      JSONArray list = parseMessages(raw);
      if (list == null || list.length() == 0) return false;

      JSONObject item = list.optJSONObject(0);
      if (item == null) return false;
      JSONObject info = item.optJSONObject("info");
      if (info == null || !"assistant".equals(info.optString("role"))) return false;

      JSONObject time = info.optJSONObject("time");
      return time != null && time.has("completed");
    } catch (Exception ignored) {
      return false;
    }
  }

  private void finish(String sessionID) {
    Log.d(TAG, "finish sessionID=" + sessionID);
    tracked.remove(sessionID);
    seen.remove(sessionID);
    start.remove(sessionID);
    if (!notify) return;
    if (active) return;
    notifyDone(sessionID);
  }

  private JSONObject loadStatus() throws Exception {
    HttpURLConnection conn = null;
    try {
      String target = url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
      conn = (HttpURLConnection) new URL(target + "/session/status").openConnection();
      conn.setRequestMethod("GET");
      conn.setConnectTimeout(10_000);
      conn.setReadTimeout(10_000);
      conn.setRequestProperty("Accept", "application/json");

      if (password != null && !password.isEmpty()) {
        String user = username == null || username.isEmpty() ? "opencode" : username;
        String token = Base64.encodeToString((user + ":" + password).getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
        conn.setRequestProperty("Authorization", "Basic " + token);
      }

      String body = read(conn.getResponseCode() >= 400 ? conn.getErrorStream() : conn.getInputStream());
      if (body.isEmpty()) return new JSONObject();

      JSONObject root = new JSONObject(body);
      JSONObject data = root.optJSONObject("data");
      return data != null ? data : root;
    } finally {
      if (conn != null) conn.disconnect();
    }
  }

  private String read(InputStream input) throws Exception {
    if (input == null) return "";
    try (InputStream src = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      byte[] buf = new byte[8 * 1024];
      while (true) {
        int n = src.read(buf);
        if (n < 0) break;
        if (n == 0) continue;
        out.write(buf, 0, n);
      }
      return out.toString(StandardCharsets.UTF_8.name());
    }
  }

  private Notification keepaliveNotification() {
    Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
    if (launch == null) launch = new Intent(this, MainActivity.class);
    launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    PendingIntent pending = PendingIntent.getActivity(
      this,
      0,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
    );

    return new NotificationCompat.Builder(this, KEEPALIVE_CHANNEL)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("OpenCode 正在运行")
      .setContentText("后台保活已开启")
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(pending)
      .build();
  }

  private void notifyDone(String sessionID) {
    Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
    if (launch == null) launch = new Intent(this, MainActivity.class);
    launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    PendingIntent pending = PendingIntent.getActivity(
      this,
      sessionID.hashCode(),
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
    );

    String body = resolveDoneText(sessionID);

    Notification item = new NotificationCompat.Builder(this, TASK_CHANNEL)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("任务已完成")
      .setContentText(body)
      .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setDefaults(NotificationCompat.DEFAULT_ALL)
      .setVibrate(new long[] { 0, 160, 120, 200 })
      .setContentIntent(pending)
      .build();

    NotificationManager manager = getSystemService(NotificationManager.class);
    if (manager == null) return;
    manager.notify(sessionID.hashCode(), item);
  }

  private String resolveDoneText(String sessionID) {
    for (int i = 0; i < 5; i += 1) {
      String text = readReplyOnce(sessionID);
      if (!text.isEmpty()) return text;
      try {
        Thread.sleep(800);
      } catch (InterruptedException ignored) {
        Thread.currentThread().interrupt();
        break;
      }
    }
    return "任务已完成";
  }

  private String readReplyOnce(String sessionID) {
    try {
      String target = url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
      HttpURLConnection conn = (HttpURLConnection) new URL(target + "/session/" + sessionID + "/message?limit=1").openConnection();
      conn.setRequestMethod("GET");
      conn.setConnectTimeout(10_000);
      conn.setReadTimeout(10_000);
      conn.setRequestProperty("Accept", "application/json");

      if (password != null && !password.isEmpty()) {
        String user = username == null || username.isEmpty() ? "opencode" : username;
        String token = Base64.encodeToString((user + ":" + password).getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
        conn.setRequestProperty("Authorization", "Basic " + token);
      }

      String raw = read(conn.getResponseCode() >= 400 ? conn.getErrorStream() : conn.getInputStream());
      JSONArray list = parseMessages(raw);
      if (list == null || list.length() == 0) return "";

      JSONObject item = list.optJSONObject(0);
      if (item == null) return "";

      JSONObject info = item.optJSONObject("info");
      if (info == null || !"assistant".equals(info.optString("role"))) return "";
      JSONObject time = info.optJSONObject("time");
      if (time == null || !time.has("completed")) return "";

      JSONArray parts = item.optJSONArray("parts");
      if (parts == null) return "";

      StringBuilder sb = new StringBuilder();
      for (int i = 0; i < parts.length(); i += 1) {
        JSONObject part = parts.optJSONObject(i);
        if (part == null) continue;
        if (!"text".equals(part.optString("type"))) continue;
        String text = part.optString("text");
        if (text == null || text.isEmpty()) continue;
        if (sb.length() > 0) sb.append('\n');
        sb.append(text);
      }

      String merged = sb.toString().replaceAll("\\s+", " ").trim();
      if (merged.isEmpty()) return "";
      return summarize(merged);
    } catch (Exception ignored) {
      return "";
    }
  }

  private JSONArray parseMessages(String raw) {
    if (raw == null || raw.isEmpty()) return null;
    try {
      return new JSONArray(raw);
    } catch (Exception ignored) {
    }

    try {
      JSONObject root = new JSONObject(raw);
      JSONArray data = root.optJSONArray("data");
      if (data != null) return data;
    } catch (Exception ignored) {
    }

    return null;
  }

  private String summarize(String text) {
    int width = 42;
    String first = text.substring(0, Math.min(text.length(), width));
    if (text.length() <= width) return first;
    String second = text.substring(width, Math.min(text.length(), width * 2));
    if (second.isEmpty()) return first + "…";
    if (text.length() > width * 2) return first + "\n" + second + "…";
    return first + "\n" + second;
  }

  private void ensureChannels() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager manager = getSystemService(NotificationManager.class);
    if (manager == null) return;

    NotificationChannel keepalive = new NotificationChannel(
      KEEPALIVE_CHANNEL,
      "后台保活",
      NotificationManager.IMPORTANCE_LOW
    );
    keepalive.setDescription("OpenCode 后台常驻服务");
    manager.createNotificationChannel(keepalive);

    NotificationChannel done = new NotificationChannel(
      TASK_CHANNEL,
      "任务完成",
      NotificationManager.IMPORTANCE_HIGH
    );
    done.setDescription("任务完成提醒");
    done.enableVibration(true);
    done.setVibrationPattern(new long[] { 0, 160, 120, 200 });
    done.setSound(
      RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
      new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build()
    );
    manager.createNotificationChannel(done);
  }
}
