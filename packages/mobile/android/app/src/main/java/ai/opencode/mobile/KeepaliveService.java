package ai.opencode.mobile;

import android.app.ActivityManager;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;
import android.util.Log;

import androidx.core.app.ServiceCompat;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;

public class KeepaliveService extends Service {
  private static final String TAG = "KeepaliveService";
  private static final int KEEPALIVE_ID = 4001;
  private static final int RESTART_ID = 4002;

  private ScheduledExecutorService poller;
  private ExecutorService watcher;
  private KeepaliveNotifier note;
  private KeepalivePoller task;
  private KeepaliveWatcher stream;
  private static volatile KeepaliveService live;

  public static void attach(Context context) {
    KeepaliveState.attach(context);
  }

  public static void start(Context context) {
    try {
      androidx.core.content.ContextCompat.startForegroundService(context, new Intent(context, KeepaliveService.class));
    } catch (Exception err) {
      Log.e(TAG, "start failed", err);
    }
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
    live = this;
    attach(this);
    note = new KeepaliveNotifier(this);
    note.ensure();
  }

  public static void refresh() {
    KeepaliveService svc = live;
    if (svc == null) return;
    svc.refreshKeepalive();
  }

  public static void syncSound() {
    KeepaliveService svc = live;
    if (svc == null) return;
    svc.refreshChannels();
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    try {
      cancelRestart();
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
      if (stream == null) stream = new KeepaliveWatcher(task, new KeepaliveClient(), note);

      if (poller == null || poller.isShutdown()) {
        poller = Executors.newSingleThreadScheduledExecutor();
        poller.scheduleWithFixedDelay(task, 0, 3, TimeUnit.SECONDS);
      }
      if (watcher == null || watcher.isShutdown()) {
        watcher = Executors.newSingleThreadExecutor();
        watcher.submit(stream);
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
    if (live == this) live = null;
    if (poller != null) {
      poller.shutdownNow();
      poller = null;
    }
    if (watcher != null) {
      watcher.shutdownNow();
      watcher = null;
    }
    note = null;
    task = null;
    stream = null;
    restart();
    super.onDestroy();
  }

  @Override
  public void onTaskRemoved(Intent rootIntent) {
    restart();
    super.onTaskRemoved(rootIntent);
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

  private void restart() {
    if (KeepaliveState.tracked().isEmpty()) return;
    if (KeepaliveState.url() == null || KeepaliveState.url().isEmpty()) return;
    try {
      AlarmManager mgr = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
      if (mgr == null) return;
      long at = SystemClock.elapsedRealtime() + 1000;
      PendingIntent item = pending();
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !mgr.canScheduleExactAlarms()) {
        mgr.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, item);
        return;
      }
      mgr.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, item);
    } catch (Exception err) {
      Log.e(TAG, "restart failed", err);
    }
  }

  private void cancelRestart() {
    try {
      AlarmManager mgr = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
      if (mgr == null) return;
      mgr.cancel(pending());
    } catch (Exception ignored) {
    }
  }

  private PendingIntent pending() {
    Intent intent = new Intent(this, KeepaliveService.class);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
    return PendingIntent.getService(this, RESTART_ID, intent, flags);
  }

  private void refreshKeepalive() {
    try {
      if (note == null) note = new KeepaliveNotifier(this);
      android.app.NotificationManager mgr = getSystemService(android.app.NotificationManager.class);
      if (mgr == null) return;
      mgr.notify(KEEPALIVE_ID, note.keepalive());
    } catch (Exception ignored) {
    }
  }

  private void refreshChannels() {
    try {
      if (note == null) note = new KeepaliveNotifier(this);
      note.ensure();
    } catch (Exception ignored) {
    }
  }
}
