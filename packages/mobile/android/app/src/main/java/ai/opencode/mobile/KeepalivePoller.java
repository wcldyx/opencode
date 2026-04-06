package ai.opencode.mobile;

import android.os.PowerManager;

import org.json.JSONObject;

import java.util.HashSet;

final class KeepalivePoller implements Runnable {
  private static final long TRACK_GRACE_MS = 15_000;

  private final KeepaliveService svc;
  private final KeepaliveClient client;
  private final KeepaliveNotifier note;

  KeepalivePoller(KeepaliveService svc, KeepaliveClient client, KeepaliveNotifier note) {
    this.svc = svc;
    this.client = client;
    this.note = note;
  }

  @Override
  public void run() {
    PowerManager mgr = (PowerManager) svc.getSystemService(KeepaliveService.POWER_SERVICE);
    PowerManager.WakeLock lock = null;
    try {
      if (mgr != null) {
        lock = mgr.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "opencode:keepalive-poll");
        lock.setReferenceCounted(false);
        lock.acquire(10_000L);
      }
      poll();
    } finally {
      if (lock != null && lock.isHeld()) lock.release();
    }
  }

  void poll() {
    if (KeepaliveState.url() == null || KeepaliveState.url().isEmpty()) return;
    if (KeepaliveState.tracked().isEmpty()) return;

    try {
      JSONObject status = client.status();
      for (String sessionID : new HashSet<>(KeepaliveState.tracked())) {
        JSONObject item = status.optJSONObject(sessionID);
        if (item != null) {
          if (!"idle".equals(item.optString("type"))) {
            KeepaliveState.seen().add(sessionID);
            KeepaliveState.done().remove(sessionID);
            KeepaliveState.setStage(sessionID, "receiving");
            KeepaliveService.refresh();
            continue;
          }
          boolean done = client.done(sessionID);
          if (!done) {
            KeepaliveState.done().remove(sessionID);
            continue;
          }
          if (!KeepaliveState.done().add(sessionID)) {
            finish(sessionID);
            continue;
          }
          continue;
        }

        if (!KeepaliveState.seen().contains(sessionID)) {
          long at = KeepaliveState.start().getOrDefault(sessionID, 0L);
          long age = System.currentTimeMillis() - at;
          if (age < TRACK_GRACE_MS) continue;
        }

        boolean done = client.done(sessionID);
        if (!done) {
          KeepaliveState.done().remove(sessionID);
          continue;
        }
        if (!KeepaliveState.done().add(sessionID)) {
          finish(sessionID);
          continue;
        }
      }
    } catch (Exception ignored) {}
  }

  synchronized void finish(String sessionID) {
    if (!KeepaliveState.tracked().contains(sessionID)) return;
    String href = KeepaliveState.href(sessionID);
    KeepaliveState.untrack(sessionID);
    KeepaliveService.refresh();
    if (!KeepaliveState.notifyOn()) return;
    if (KeepaliveState.active()) return;
    String body = client.reply(sessionID);
    if (body == null || body.isEmpty()) body = "任务已完成";
    note.done(sessionID, href, body);
  }
}
