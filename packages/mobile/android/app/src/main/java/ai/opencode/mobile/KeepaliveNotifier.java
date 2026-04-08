package ai.opencode.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import androidx.core.app.NotificationCompat;

final class KeepaliveNotifier {
  static final String KEEPALIVE_CHANNEL = "opencode-keepalive";
  static final String TASK_CHANNEL = "opencode-task-v4";
  static final String TASK_CHANNEL_OLD = "opencode-task-v3";
  static final String TASK_CHANNEL_OLD_2 = "opencode-task-v2";
  static final long[] TASK_VIBRATE = new long[] { 0, 420 };

  private final KeepaliveService svc;

  KeepaliveNotifier(KeepaliveService svc) {
    this.svc = svc;
  }

  void ensure() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager mgr = svc.getSystemService(NotificationManager.class);
    if (mgr == null) return;

    NotificationChannel keepalive = new NotificationChannel(
      KEEPALIVE_CHANNEL,
      "后台保活",
      NotificationManager.IMPORTANCE_LOW
    );
    keepalive.setDescription("OpenCode 后台常驻服务");
    mgr.createNotificationChannel(keepalive);

    mgr.deleteNotificationChannel(TASK_CHANNEL_OLD_2);
    mgr.deleteNotificationChannel(TASK_CHANNEL_OLD);

    NotificationChannel done = new NotificationChannel(
      TASK_CHANNEL,
      "任务完成",
      NotificationManager.IMPORTANCE_HIGH
    );
    done.setDescription("任务完成提醒");
    done.enableVibration(true);
    done.setVibrationPattern(TASK_VIBRATE);
    done.setSound(sound(), new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());
    done.enableLights(true);
    done.setLightColor(Color.parseColor("#7C3AED"));
    mgr.createNotificationChannel(done);
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
    ensure();
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      ring();
      vibrate();
    }

    Intent launch = svc.getPackageManager().getLaunchIntentForPackage(svc.getPackageName());
    if (launch == null) launch = new Intent(svc, MainActivity.class);
    launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    if (href != null) launch.putExtra("href", href);
    PendingIntent open = PendingIntent.getActivity(
      svc,
      sessionID.hashCode(),
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
    );

    Notification item = new NotificationCompat.Builder(svc, TASK_CHANNEL)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("OpenCode · 任务完成")
      .setContentText(body == null || body.isEmpty() ? "点击查看会话" : body)
      .setStyle(new NotificationCompat.BigTextStyle().bigText(body == null || body.isEmpty() ? "任务已完成" : body))
      .setAutoCancel(true)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setDefaults(NotificationCompat.DEFAULT_ALL)
      .setVibrate(TASK_VIBRATE)
      .setSound(sound())
      .setColor(Color.parseColor("#7C3AED"))
      .setSubText("OpenCode")
      .setContentIntent(open)
      .addAction(android.R.drawable.ic_menu_view, "打开会话", open)
      .build();

    NotificationManager mgr = svc.getSystemService(NotificationManager.class);
    if (mgr == null) return;
    mgr.notify(sessionID.hashCode(), item);
  }

  private Uri sound() {
    return Uri.parse("android.resource://" + svc.getPackageName() + "/raw/" + resourceName());
  }

  private void ring() {
    try {
      MediaPlayer item = new MediaPlayer();
      item.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());
      item.setDataSource(svc, sound());
      item.setOnPreparedListener(MediaPlayer::start);
      item.setOnCompletionListener(MediaPlayer::release);
      item.setOnErrorListener((player, what, extra) -> {
        player.release();
        return true;
      });
      item.prepareAsync();
    } catch (Exception ignored) {
    }
  }

  private void vibrate() {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        VibratorManager mgr = (VibratorManager) svc.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
        if (mgr == null) return;
        Vibrator item = mgr.getDefaultVibrator();
        if (!item.hasVibrator()) return;
        item.vibrate(VibrationEffect.createWaveform(TASK_VIBRATE, -1));
        return;
      }

      Vibrator item = (Vibrator) svc.getSystemService(Context.VIBRATOR_SERVICE);
      if (item == null || !item.hasVibrator()) return;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        item.vibrate(VibrationEffect.createWaveform(TASK_VIBRATE, -1));
        return;
      }
      item.vibrate(TASK_VIBRATE, -1);
    } catch (Exception ignored) {
    }
  }

  private String resourceName() {
    String name = KeepaliveState.sound();
    if (name == null || name.isEmpty()) return "staplebops_01";
    String file = name.replace('-', '_');
    int id = svc.getResources().getIdentifier(file, "raw", svc.getPackageName());
    if (id != 0) return file;
    return "staplebops_01";
  }
}
