package ai.opencode.mobile;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

final class KeepaliveState {
  private static final String PREF = "opencode.keepalive.v1";
  private static final String KEY_URL = "url";
  private static final String KEY_USERNAME = "username";
  private static final String KEY_PASSWORD = "password";
  private static final String KEY_NOTIFY = "notify";
  private static final String KEY_SOUND = "sound";
  private static final String KEY_TRACKED = "tracked";
  private static final String KEY_SEEN = "seen";
  private static final String KEY_START = "start";
  private static final String KEY_DIR = "dir";
  private static final String KEY_HREF = "href";

  private static final Set<String> tracked = ConcurrentHashMap.newKeySet();
  private static final Set<String> seen = ConcurrentHashMap.newKeySet();
  private static final Set<String> done = ConcurrentHashMap.newKeySet();
  private static final Map<String, Long> start = new ConcurrentHashMap<>();
  private static final Map<String, String> dir = new ConcurrentHashMap<>();
  private static final Map<String, String> stage = new ConcurrentHashMap<>();

  private static volatile String url;
  private static volatile String username;
  private static volatile String password;
  private static volatile boolean notify = true;
  private static volatile String sound = "staplebops-01";
  private static volatile boolean active;
  private static volatile Context app;
  private static volatile String href;

  private KeepaliveState() {}

  static void attach(Context ctx) {
    if (ctx == null) return;
    app = ctx.getApplicationContext();
    restore();
  }

  static void configure(String nextUrl, String nextUser, String nextPass, Boolean nextNotify) {
    if (url != null && nextUrl != null && !url.equals(nextUrl)) {
      tracked.clear();
      seen.clear();
      done.clear();
      start.clear();
      dir.clear();
      stage.clear();
    }
    url = nextUrl;
    username = nextUser;
    password = nextPass;
    if (nextNotify != null) notify = nextNotify;
    persist();
  }

  static void setActive(boolean next) {
    active = next;
  }

  static void setNotify(boolean next) {
    notify = next;
    persist();
  }

  static void setSound(String next) {
    sound = next == null || next.isEmpty() ? "staplebops-01" : next;
    persist();
  }

  static void track(String sessionID, String directory) {
    tracked.add(sessionID);
    done.remove(sessionID);
    start.put(sessionID, System.currentTimeMillis());
    if (directory != null && !directory.isEmpty()) dir.put(sessionID, directory);
    stage.put(sessionID, "sending");
    persist();
  }

  static void untrack(String sessionID) {
    tracked.remove(sessionID);
    seen.remove(sessionID);
    done.remove(sessionID);
    start.remove(sessionID);
    dir.remove(sessionID);
    stage.remove(sessionID);
    persist();
  }

  static String url() { return url; }
  static String username() { return username; }
  static String password() { return password; }
  static boolean notifyOn() { return notify; }
  static String sound() { return sound; }
  static boolean active() { return active; }
  static Set<String> tracked() { return tracked; }
  static Set<String> seen() { return seen; }
  static Set<String> done() { return done; }
  static Map<String, Long> start() { return start; }
  static String directory(String sessionID) { return dir.get(sessionID); }
  static void setLaunchHref(String value) {
    href = value;
    persist();
  }

  static String consumeLaunchHref() {
    String value = href;
    href = null;
    persist();
    return value;
  }

  static void setStage(String sessionID, String value) {
    if (sessionID == null || sessionID.isEmpty()) return;
    if (!tracked.contains(sessionID)) return;
    stage.put(sessionID, value);
  }

  static String status() {
    if (tracked.isEmpty()) return "空闲";
    if (stage.containsValue("waiting")) return "等待授权";
    if (stage.containsValue("receiving")) return "接收中";
    if (stage.containsValue("sending")) return "发送中";
    return "处理中";
  }

  static String href(String sessionID) {
    String value = dir.get(sessionID);
    if (value == null || value.isEmpty()) return null;
    return "/" + encode(value) + "/session/" + sessionID;
  }

  private static String encode(String value) {
    return android.util.Base64.encodeToString(
      value.getBytes(java.nio.charset.StandardCharsets.UTF_8),
      android.util.Base64.URL_SAFE | android.util.Base64.NO_WRAP | android.util.Base64.NO_PADDING
    );
  }

  private static synchronized void persist() {
    if (app == null) return;
    try {
      SharedPreferences pref = app.getSharedPreferences(PREF, Context.MODE_PRIVATE);
      SharedPreferences.Editor editor = pref.edit();
      editor.putString(KEY_URL, url);
      editor.putString(KEY_USERNAME, username);
      editor.putString(KEY_PASSWORD, password);
      editor.putBoolean(KEY_NOTIFY, notify);
      editor.putString(KEY_SOUND, sound);
      editor.putString(KEY_TRACKED, array(tracked).toString());
      editor.putString(KEY_SEEN, array(seen).toString());
      editor.putString(KEY_START, object(start).toString());
      editor.putString(KEY_DIR, objectString(dir).toString());
      editor.putString(KEY_HREF, href);
      editor.apply();
    } catch (Exception ignored) {
    }
  }

  private static synchronized void restore() {
    if (app == null) return;
    try {
      SharedPreferences pref = app.getSharedPreferences(PREF, Context.MODE_PRIVATE);
      url = pref.getString(KEY_URL, url);
      username = pref.getString(KEY_USERNAME, username);
      password = pref.getString(KEY_PASSWORD, password);
      notify = pref.getBoolean(KEY_NOTIFY, notify);
      sound = pref.getString(KEY_SOUND, sound);
      href = pref.getString(KEY_HREF, href);

      Set<String> trackedState = set(new JSONArray(pref.getString(KEY_TRACKED, "[]")));
      Set<String> seenState = set(new JSONArray(pref.getString(KEY_SEEN, "[]")));
      Map<String, Long> startState = map(new JSONObject(pref.getString(KEY_START, "{}")));
      Map<String, String> dirState = mapString(new JSONObject(pref.getString(KEY_DIR, "{}")));

      tracked.clear();
      tracked.addAll(trackedState);
      seen.clear();
      seen.addAll(seenState);
      done.clear();
      start.clear();
      start.putAll(startState);
      dir.clear();
      dir.putAll(dirState);
    } catch (Exception ignored) {
    }
  }

  private static JSONArray array(Set<String> set) {
    JSONArray out = new JSONArray();
    for (String item : set) out.put(item);
    return out;
  }

  private static Set<String> set(JSONArray list) {
    Set<String> out = ConcurrentHashMap.newKeySet();
    if (list == null) return out;
    for (int i = 0; i < list.length(); i += 1) {
      String item = list.optString(i, "");
      if (item.isEmpty()) continue;
      out.add(item);
    }
    return out;
  }

  private static JSONObject object(Map<String, Long> map) {
    JSONObject out = new JSONObject();
    for (Map.Entry<String, Long> item : map.entrySet()) {
      try {
        out.put(item.getKey(), item.getValue());
      } catch (Exception ignored) {
      }
    }
    return out;
  }

  private static JSONObject objectString(Map<String, String> map) {
    JSONObject out = new JSONObject();
    for (Map.Entry<String, String> item : map.entrySet()) {
      try {
        if (item.getValue() == null || item.getValue().isEmpty()) continue;
        out.put(item.getKey(), item.getValue());
      } catch (Exception ignored) {
      }
    }
    return out;
  }

  private static Map<String, Long> map(JSONObject obj) {
    Map<String, Long> out = new ConcurrentHashMap<>();
    if (obj == null) return out;
    Iterator<String> keys = obj.keys();
    while (keys.hasNext()) {
      String key = keys.next();
      long item = obj.optLong(key, 0L);
      if (item <= 0L) continue;
      out.put(key, item);
    }
    return out;
  }

  private static Map<String, String> mapString(JSONObject obj) {
    Map<String, String> out = new ConcurrentHashMap<>();
    if (obj == null) return out;
    Iterator<String> keys = obj.keys();
    while (keys.hasNext()) {
      String key = keys.next();
      String item = obj.optString(key, "");
      if (item.isEmpty()) continue;
      out.put(key, item);
    }
    return out;
  }
}
