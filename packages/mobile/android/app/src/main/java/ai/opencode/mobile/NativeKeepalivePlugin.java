package ai.opencode.mobile;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeKeepalive")
public class NativeKeepalivePlugin extends Plugin {
  private static final String TAG = "NativeKeepalive";

  @PluginMethod
  public void configure(PluginCall call) {
    String url = call.getString("url");
    if (url == null || url.isEmpty()) {
      call.reject("Missing url");
      return;
    }

    Boolean notify = call.getBoolean("notify");
    KeepaliveService.configure(url, call.getString("username"), call.getString("password"), notify);
    try {
      Log.d(TAG, "configure url=" + url);
      start();
      call.resolve();
    } catch (Exception err) {
      Log.e(TAG, "configure failed", err);
      call.reject(err.getMessage(), err);
    }
  }

  @PluginMethod
  public void track(PluginCall call) {
    String sessionID = call.getString("sessionID");
    if (sessionID == null || sessionID.isEmpty()) {
      call.resolve();
      return;
    }

    KeepaliveService.track(sessionID);
    try {
      Log.d(TAG, "track sessionID=" + sessionID);
      start();
      call.resolve();
    } catch (Exception err) {
      Log.e(TAG, "track failed", err);
      call.reject(err.getMessage(), err);
    }
  }

  @PluginMethod
  public void untrack(PluginCall call) {
    String sessionID = call.getString("sessionID");
    if (sessionID != null && !sessionID.isEmpty()) KeepaliveService.untrack(sessionID);
    call.resolve();
  }

  @PluginMethod
  public void setNotify(PluginCall call) {
    Boolean notify = call.getBoolean("notify");
    KeepaliveService.setNotify(notify == null ? true : notify);
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

  private void start() {
    Intent intent = new Intent(getContext(), KeepaliveService.class);
    ContextCompat.startForegroundService(getContext(), intent);
  }
}
