package ai.opencode.mobile;

import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class KeepaliveClient {
  interface Watch {
    void onEvent(JSONObject event) throws Exception;
  }

  KeepaliveClient() {}

  void events(Watch watch) throws Exception {
    HttpURLConnection conn = null;
    try {
      conn = open("/global/event", "text/event-stream", 35_000);
      int code = conn.getResponseCode();
      if (code >= 400) throw new IllegalStateException("sse failed: " + code + " " + read(conn.getErrorStream()));
      InputStream body = conn.getInputStream();
      if (body == null) throw new IllegalStateException("sse missing body");
      try (BufferedReader reader = new BufferedReader(new InputStreamReader(body, StandardCharsets.UTF_8))) {
        StringBuilder data = new StringBuilder();
        while (true) {
          String line = reader.readLine();
          if (line == null) {
            flush(data, watch);
            return;
          }
          if (line.isEmpty()) {
            flush(data, watch);
            continue;
          }
          if (!line.startsWith("data:")) continue;
          if (data.length() > 0) data.append('\n');
          data.append(line.substring(5).trim());
        }
      }
    } finally {
      if (conn != null) conn.disconnect();
    }
  }

  JSONObject status() throws Exception {
    HttpURLConnection conn = null;
    try {
      conn = open("/session/status", "application/json", 10_000);
      String body = read(conn.getResponseCode() >= 400 ? conn.getErrorStream() : conn.getInputStream());
      if (body.isEmpty()) return new JSONObject();
      JSONObject root = new JSONObject(body);
      JSONObject data = root.optJSONObject("data");
      return data != null ? data : root;
    } finally {
      if (conn != null) conn.disconnect();
    }
  }

  boolean done(String sessionID) {
    try {
      JSONArray list = messages(sessionID);
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

  String reply(String sessionID) {
    HttpURLConnection conn = null;
    try {
      conn = open("/session/" + sessionID + "/message?limit=1", "application/json", 10_000);
      String raw = read(conn.getResponseCode() >= 400 ? conn.getErrorStream() : conn.getInputStream());
      JSONArray list = parse(raw);
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
    } finally {
      if (conn != null) conn.disconnect();
    }
  }

  private JSONArray messages(String sessionID) throws Exception {
    HttpURLConnection conn = null;
    try {
      conn = open("/session/" + sessionID + "/message?limit=1", "application/json", 10_000);
      String raw = read(conn.getResponseCode() >= 400 ? conn.getErrorStream() : conn.getInputStream());
      return parse(raw);
    } finally {
      if (conn != null) conn.disconnect();
    }
  }

  private HttpURLConnection open(String path, String accept, int readTimeout) throws Exception {
    String url = KeepaliveState.url();
    String username = KeepaliveState.username();
    String password = KeepaliveState.password();
    String target = url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    HttpURLConnection conn = (HttpURLConnection) new URL(target + path).openConnection();
    conn.setRequestMethod("GET");
    conn.setConnectTimeout(10_000);
    conn.setReadTimeout(readTimeout);
    conn.setRequestProperty("Accept", accept);

    if (password != null && !password.isEmpty()) {
      String user = username == null || username.isEmpty() ? "opencode" : username;
      String token = Base64.encodeToString((user + ":" + password).getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
      conn.setRequestProperty("Authorization", "Basic " + token);
    }

    return conn;
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

  private JSONArray parse(String raw) {
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

  private void flush(StringBuilder data, Watch watch) throws Exception {
    if (data.length() == 0) return;
    String raw = data.toString();
    data.setLength(0);
    watch.onEvent(new JSONObject(raw));
  }
}
