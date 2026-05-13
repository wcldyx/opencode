package ai.opencode.mobile;

import android.content.Context;
import android.content.Intent;
import android.content.ComponentName;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeKeepalive")
public class NativeKeepalivePlugin extends Plugin {
  private static final String TAG = "NativeKeepalive";
  private static final String STORAGE_PREFIX = "opencode.storage.";

  @PluginMethod
  public void configure(PluginCall call) {
    KeepaliveService.attach(getContext());
    String url = call.getString("url");
    if (url == null || url.isEmpty()) {
      call.reject("Missing url");
      return;
    }

    Boolean notify = call.getBoolean("notify");
    KeepaliveService.configure(url, call.getString("username"), call.getString("password"), notify);
    try {
      start();
      call.resolve();
    } catch (Exception err) {
      Log.e(TAG, "configure failed", err);
      call.reject(err.getMessage(), err);
    }
  }

  @PluginMethod
  public void track(PluginCall call) {
    KeepaliveService.attach(getContext());
    String sessionID = call.getString("sessionID");
    String directory = call.getString("directory");
    if (sessionID == null || sessionID.isEmpty()) {
      call.resolve();
      return;
    }

    KeepaliveService.track(sessionID, directory);
    KeepaliveService.refresh();
    try {
      start();
      call.resolve();
    } catch (Exception err) {
      Log.e(TAG, "track failed", err);
      call.reject(err.getMessage(), err);
    }
  }

  @PluginMethod
  public void untrack(PluginCall call) {
    KeepaliveService.attach(getContext());
    String sessionID = call.getString("sessionID");
    if (sessionID != null && !sessionID.isEmpty()) {
      KeepaliveService.untrack(sessionID);
      KeepaliveService.refresh();
    }
    call.resolve();
  }

  @PluginMethod
  public void config(PluginCall call) {
    KeepaliveService.attach(getContext());
    JSObject out = new JSObject();
    out.put("url", KeepaliveState.url());
    out.put("username", KeepaliveState.username());
    out.put("password", KeepaliveState.password());
    call.resolve(out);
  }

  @PluginMethod
  public void storageGet(PluginCall call) {
    String key = call.getString("key");
    if (key == null || key.isEmpty()) {
      call.reject("Missing key");
      return;
    }
    JSObject out = new JSObject();
    out.put("value", storage(call.getString("name")).getString(key, null));
    call.resolve(out);
  }

  @PluginMethod
  public void storageSet(PluginCall call) {
    String key = call.getString("key");
    String value = call.getString("value");
    if (key == null || key.isEmpty()) {
      call.reject("Missing key");
      return;
    }
    if (value == null) {
      call.reject("Missing value");
      return;
    }
    storage(call.getString("name")).edit().putString(key, value).apply();
    call.resolve();
  }

  @PluginMethod
  public void storageRemove(PluginCall call) {
    String key = call.getString("key");
    if (key == null || key.isEmpty()) {
      call.reject("Missing key");
      return;
    }
    storage(call.getString("name")).edit().remove(key).apply();
    call.resolve();
  }

  @PluginMethod
  public void setNotify(PluginCall call) {
    KeepaliveService.attach(getContext());
    Boolean notify = call.getBoolean("notify");
    KeepaliveService.setNotify(notify == null ? true : notify);
    call.resolve();
  }

  @PluginMethod
  public void setSound(PluginCall call) {
    KeepaliveService.attach(getContext());
    KeepaliveState.setSound(call.getString("sound"));
    KeepaliveService.syncSound();
    KeepaliveService.refresh();
    call.resolve();
  }

  @PluginMethod
  public void openNotificationSettings(PluginCall call) {
    Context ctx = getContext();
    Intent intent;

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
    } else {
      intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
        .setData(Uri.fromParts("package", ctx.getPackageName(), null));
    }

    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    ctx.startActivity(intent);
    call.resolve();
  }

  @PluginMethod
  public void backgroundStatus(PluginCall call) {
    Context ctx = getContext();
    String maker = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
    String model = Build.MODEL == null ? "" : Build.MODEL;
    boolean battery = false;

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      PowerManager mgr = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
      if (mgr != null) {
        battery = !mgr.isIgnoringBatteryOptimizations(ctx.getPackageName());
      }
    }

    JSObject out = new JSObject();
    out.put("maker", maker);
    out.put("model", model);
    out.put("battery", battery);
    call.resolve(out);
  }

  @PluginMethod
  public void consumeLaunchHref(PluginCall call) {
    KeepaliveService.attach(getContext());
    JSObject out = new JSObject();
    out.put("href", KeepaliveState.consumeLaunchHref());
    call.resolve(out);
  }

  @PluginMethod
  public void openPowerSettings(PluginCall call) {
    Context ctx = getContext();

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      Intent ask = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
        .setData(Uri.parse("package:" + ctx.getPackageName()));
      ask.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      if (startSafe(ctx, ask)) {
        call.resolve();
        return;
      }
    }

    Intent list = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    if (startSafe(ctx, list)) {
      call.resolve();
      return;
    }

    Intent app = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
      .setData(Uri.fromParts("package", ctx.getPackageName(), null))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    startSafe(ctx, app);
    call.resolve();
  }

  @PluginMethod
  public void openAutoStartSettings(PluginCall call) {
    Context ctx = getContext();
    String maker = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();

    if (maker.contains("vivo") || maker.contains("iqoo")) {
      Intent a = new Intent()
        .setComponent(new ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      if (startSafe(ctx, a)) {
        call.resolve();
        return;
      }

      Intent b = new Intent()
        .setComponent(new ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      if (startSafe(ctx, b)) {
        call.resolve();
        return;
      }

      Intent c = new Intent()
        .setComponent(new ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.SoftPermissionDetailActivity"))
        .putExtra("packagename", ctx.getPackageName())
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      if (startSafe(ctx, c)) {
        call.resolve();
        return;
      }
    }

    Intent app = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
      .setData(Uri.fromParts("package", ctx.getPackageName(), null))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    startSafe(ctx, app);
    call.resolve();
  }

  private boolean startSafe(Context ctx, Intent intent) {
    try {
      if (intent.resolveActivity(ctx.getPackageManager()) == null) return false;
      ctx.startActivity(intent);
      return true;
    } catch (Exception ignored) {
      return false;
    }
  }

  private void start() {
    Intent intent = new Intent(getContext(), KeepaliveService.class);
    ContextCompat.startForegroundService(getContext(), intent);
  }

  private SharedPreferences storage(String name) {
    String value = name == null || name.isEmpty() ? "default.dat" : name;
    return getContext().getSharedPreferences(STORAGE_PREFIX + value, Context.MODE_PRIVATE);
  }
}
