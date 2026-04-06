package ai.opencode.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

final class KeepaliveNotifier {
  private static final String TAG = "KeepaliveNotifier";
  static final String KEEPALIVE_CHANNEL = "opencode-keepalive";
  static final String TASK_CHANNEL = "opencode-task-v2";
  static final long[] TASK_VIBRATE = new long[] { 0, 320, 160, 380 };

  private final KeepaliveService svc;

  KeepaliveNotifier(KeepaliveService svc) {
    this.svc = svc;
  }

  void ensure() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager manager = svc.getSystemService(NotificationManager.class);
    if (manager == null) return;

    NotificationChannel keepalive = new NotificationChannel(
      KEEPALIVE_CHANNEL,
      "后台保活",
      NotificationManager.IMPORTANCE_LOW
    );
    keepalive.setDescription("OpenCode 后台常驻服务");
    manager.createNotificationChannel(keepalive);
    manager.deleteNotificationChannel(TASK_CHANNEL);

    NotificationChannel done = new NotificationChannel(
      TASK_CHANNEL,
      "任务完成",
      NotificationManager.IMPORTANCE_HIGH
    );
    done.setDescription("任务完成提醒");
    done.enableVibration(true);
    done.setVibrationPattern(TASK_VIBRATE);
    done.setSound(
      sound(),
      new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build()
    );
    manager.createNotificationChannel(done);
  }

  Notification keepalive() {
    Intent launch = svc.getPackageManager().getLaunchIntentForPackage(svc.getPackageName());
    if (launch == null) launch = new Intent(svc, MainActivity.class);
    launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    PendingIntent pending = PendingIntent.getActivity(
      svc,
      0,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
    );

    return new NotificationCompat.Builder(svc, KEEPALIVE_CHANNEL)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("OpenCode 正在运行")
      .setContentText(KeepaliveState.status())
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(pending)
      .build();
  }

  void done(String sessionID, String href, String body) {
    ring(sessionID);
    Intent launch = svc.getPackageManager().getLaunchIntentForPackage(svc.getPackageName());
    if (launch == null) launch = new Intent(svc, MainActivity.class);
    launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    if (href != null) launch.putExtra("href", href);
    PendingIntent pending = PendingIntent.getActivity(
      svc,
      sessionID.hashCode(),
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
    );

    Notification item = new NotificationCompat.Builder(svc, TASK_CHANNEL)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("任务已完成")
      .setContentText(body)
      .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setDefaults(NotificationCompat.DEFAULT_ALL)
      .setVibrate(TASK_VIBRATE)
      .setContentIntent(pending)
      .build();

    NotificationManager manager = svc.getSystemService(NotificationManager.class);
    if (manager == null) return;
    manager.notify(sessionID.hashCode(), item);
  }

  private void ring(String sessionID) {
    try {
      Ringtone item = RingtoneManager.getRingtone(svc, sound());
      if (item == null) return;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        item.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());
      }
      item.play();
    } catch (Exception err) {
      Log.d(TAG, "done sessionID=" + sessionID + " ringtone-failed", err);
    }
  }

  private Uri sound() {
    int id = resource();
    return Uri.parse("android.resource://" + svc.getPackageName() + "/" + id);
  }

  private int resource() {
    String name = KeepaliveState.sound();
    if (name == null || name.isEmpty()) return R.raw.staplebops_01;
    int id = svc.getResources().getIdentifier(name.replace('-', '_'), "raw", svc.getPackageName());
    if (id != 0) return id;
    return R.raw.staplebops_01;
  }
}
