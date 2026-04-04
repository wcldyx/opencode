package ai.opencode.mobile;

import android.app.ActivityManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.ServiceCompat;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class KeepaliveService extends Service {
  private static final String TAG = "KeepaliveService";
  private static final int KEEPALIVE_ID = 4001;

  private ScheduledExecutorService poller;
  private KeepaliveNotifier note;
  private KeepalivePoller task;

  public static void attach(Context context) {
    KeepaliveState.attach(context);
  }

  public static void configure(String nextUrl, String nextUsername, String nextPassword, Boolean nextNotify) {
    KeepaliveState.configure(nextUrl, nextUsername, nextPassword, nextNotify);
  }

  public static void setActive(boolean next) {
    KeepaliveState.setActive(next);
  }

  public static void setNotify(boolean next) {
    KeepaliveState.setNotify(next);
  }

  public static void track(String sessionID, String directory) {
    KeepaliveState.track(sessionID, directory);
  }

  public static void untrack(String sessionID) {
    KeepaliveState.untrack(sessionID);
  }

  @Override
  public void onCreate() {
    super.onCreate();
    attach(this);
    note = new KeepaliveNotifier(this);
    note.ensure();
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    try {
      Log.d(TAG, "onStartCommand tracked=" + KeepaliveState.tracked().size() + " url=" + (KeepaliveState.url() == null ? "" : KeepaliveState.url()));
      if (note == null) note = new KeepaliveNotifier(this);
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        ServiceCompat.startForeground(
          this,
          KEEPALIVE_ID,
          note.keepalive(),
          ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        );
      } else {
        startForeground(KEEPALIVE_ID, note.keepalive());
      }

      if (task == null) task = new KeepalivePoller(this, new KeepaliveClient(), note);

      if (poller == null || poller.isShutdown()) {
        poller = Executors.newSingleThreadScheduledExecutor();
        poller.scheduleWithFixedDelay(task, 0, 3, TimeUnit.SECONDS);
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
    note = null;
    task = null;
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  boolean foreground() {
    ActivityManager mgr = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
    if (mgr == null) return false;
    int pid = android.os.Process.myPid();
    java.util.List<ActivityManager.RunningAppProcessInfo> list = mgr.getRunningAppProcesses();
    if (list == null) return false;
    for (ActivityManager.RunningAppProcessInfo item : list) {
      if (item.pid != pid) continue;
      return item.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND ||
        item.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE;
    }
    return false;
  }
}
