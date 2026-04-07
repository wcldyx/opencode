package ai.opencode.mobile;

import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(name = "NativeHttp")
public class NativeHttpPlugin extends Plugin {
  private static final String TAG = "OpenCode/NativeHttp";
  private final ConcurrentHashMap<String, HttpURLConnection> active = new ConcurrentHashMap<>();

  @PluginMethod
  public void stream(PluginCall call) {
    String id = call.getString("id");
    if (id == null) {
      call.reject("Missing id");
      return;
    }

    new Thread(
      () -> {
        HttpURLConnection conn = null;
        boolean settled = false;
        try {
          conn = open(call);
          active.put(id, conn);

          JSObject meta = new JSObject();
          meta.put("status", conn.getResponseCode());
          meta.put("headers", headers(conn));
          call.resolve(meta);
          settled = true;

          BufferedInputStream src =
            new BufferedInputStream(conn.getResponseCode() >= 400 ? (conn.getErrorStream() != null ? conn.getErrorStream() : conn.getInputStream()) : conn.getInputStream());
          byte[] buf = new byte[8 * 1024];
          while (true) {
            int n = src.read(buf);
            if (n < 0) break;
            if (n == 0) continue;

            JSObject chunk = new JSObject();
            chunk.put("id", id);
            chunk.put("chunk", Base64.encodeToString(buf, 0, n, Base64.NO_WRAP));
            notifyListeners("nativeHttpChunk", chunk);
          }

          src.close();

          JSObject done = new JSObject();
          done.put("id", id);
          notifyListeners("nativeHttpDone", done);
        } catch (Exception err) {
          Log.e(TAG, "stream error id=" + id + " message=" + (err.getMessage() == null ? "native stream failed" : err.getMessage()), err);
          JSObject fail = new JSObject();
          fail.put("id", id);
          fail.put("message", err.getMessage() == null ? "native stream failed" : err.getMessage());
          notifyListeners("nativeHttpError", fail);
          if (!settled) call.reject(err.getMessage(), err);
        } finally {
          HttpURLConnection item = active.remove(id);
          if (item != null) item.disconnect();
          if (conn != null) conn.disconnect();
        }
      }
    ).start();
  }

  @PluginMethod
  public void abort(PluginCall call) {
    String id = call.getString("id");
    if (id == null) {
      call.resolve();
      return;
    }

    HttpURLConnection conn = active.remove(id);
    if (conn != null) conn.disconnect();
    call.resolve();
  }

  @PluginMethod
  public void request(PluginCall call) {
    new Thread(
      () -> {
        HttpURLConnection conn = null;
        try {
          conn = open(call);
          String body = readBody(conn);
          JSObject res = new JSObject();
          res.put("status", conn.getResponseCode());
          res.put("headers", headers(conn));
          res.put("data", body);
          call.resolve(res);
        } catch (Exception err) {
          Log.e(TAG, "request error url=" + opt(call.getString("url"), "") + " message=" + err.getMessage(), err);
          call.reject(err.getMessage(), err);
        } finally {
          if (conn != null) conn.disconnect();
        }
      }
    ).start();
  }

  private HttpURLConnection open(PluginCall call) throws Exception {
    String url = call.getString("url");
    if (url == null) throw new IllegalArgumentException("Missing url");
    HttpURLConnection req = (HttpURLConnection) new URL(url).openConnection();
    String method = call.getString("method");
    boolean stream = isStream(url);
    req.setRequestMethod(method == null ? "GET" : method);
    req.setInstanceFollowRedirects(true);
    req.setConnectTimeout(30_000);
    req.setReadTimeout(stream ? 0 : 30_000);

    // Keep SSE/event streams as plain text. HttpURLConnection does not reliably
    // transparently decode gzip, which can leave the JS SSE parser reading raw bytes.
    if (stream) {
      req.setRequestProperty("Accept-Encoding", "identity");
      req.setRequestProperty("Cache-Control", "no-cache");
    }

    JSObject headers = call.getObject("headers");
    if (headers != null) {
      Iterator<String> it = headers.keys();
      while (it.hasNext()) {
        String key = it.next();
        String value = headers.optString(key, null);
        if (value != null) req.setRequestProperty(key, value);
      }
    }

    String body = call.getString("body");
    String reqMethod = req.getRequestMethod();
    if (body != null && !body.isEmpty() && !"GET".equals(reqMethod) && !"HEAD".equals(reqMethod)) {
      req.setDoOutput(true);
      req.getOutputStream().write(body.getBytes(StandardCharsets.UTF_8));
      req.getOutputStream().close();
    }

    return req;
  }

  private String readBody(HttpURLConnection conn) throws Exception {
    BufferedInputStream src;
    try {
      src = new BufferedInputStream(conn.getResponseCode() >= 400 ? conn.getErrorStream() : conn.getInputStream());
    } catch (Exception ignored) {
      if (conn.getErrorStream() == null) return "";
      src = new BufferedInputStream(conn.getErrorStream());
    }

    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buf = new byte[8 * 1024];
    while (true) {
      int n = src.read(buf);
      if (n < 0) break;
      if (n == 0) continue;
      out.write(buf, 0, n);
    }
    src.close();
    return out.toString(StandardCharsets.UTF_8);
  }

  private JSObject headers(HttpURLConnection conn) {
    JSObject obj = new JSObject();
    for (Map.Entry<String, List<String>> item : conn.getHeaderFields().entrySet()) {
      if (item.getKey() == null || item.getValue() == null || item.getValue().isEmpty()) continue;
      obj.put(item.getKey(), item.getValue().get(0));
    }
    return obj;
  }

  private boolean isStream(String url) {
    return url.contains("/event") || url.contains("/sync-event");
  }

  private String opt(String value, String fallback) {
    return value == null ? fallback : value;
  }
}
