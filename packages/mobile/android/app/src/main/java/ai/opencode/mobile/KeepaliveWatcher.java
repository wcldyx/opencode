package ai.opencode.mobile;

import org.json.JSONObject;

final class KeepaliveWatcher implements Runnable {
  private final KeepalivePoller poller;
  private final KeepaliveClient client;
  private final KeepaliveNotifier note;

  KeepaliveWatcher(KeepalivePoller poller, KeepaliveClient client, KeepaliveNotifier note) {
    this.poller = poller;
    this.client = client;
    this.note = note;
  }

  @Override
  public void run() {
    while (!Thread.currentThread().isInterrupted()) {
      try {
        if (KeepaliveState.url() == null || KeepaliveState.url().isEmpty()) {
          sleep(1000L);
          continue;
        }
        if (KeepaliveState.tracked().isEmpty()) {
          sleep(1000L);
          continue;
        }
        client.events(this::onEvent);
      } catch (InterruptedException ignored) {
        Thread.currentThread().interrupt();
        return;
      } catch (Exception err) {
        try {
          sleep(1500L);
        } catch (InterruptedException ignored) {
          Thread.currentThread().interrupt();
          return;
        }
      }
    }
  }

  private void onEvent(JSONObject event) {
    JSONObject payload = event.optJSONObject("payload");
    if (payload == null) return;
    String type = payload.optString("type", "");
    if (type.isEmpty()) return;
    if ("server.connected".equals(type) || "server.heartbeat".equals(type)) return;

    JSONObject props = payload.optJSONObject("properties");
    String sessionID = props == null ? "" : props.optString("sessionID", "");
    if (sessionID.isEmpty()) return;
    if (!KeepaliveState.tracked().contains(sessionID)) return;
    if ("permission.asked".equals(type) || "question.asked".equals(type)) {
      boolean first = !KeepaliveState.asked(sessionID);
      KeepaliveState.ask(sessionID);
      KeepaliveService.refresh();
      if (first && KeepaliveState.notifyOn() && !KeepaliveState.active()) {
        note.ask(sessionID, KeepaliveState.href(sessionID), "permission.asked".equals(type));
      }
      return;
    }

    if ("permission.replied".equals(type) || "question.replied".equals(type) || "question.rejected".equals(type)) {
      KeepaliveState.reply(sessionID);
      KeepaliveService.refresh();
      return;
    }

    if ("session.idle".equals(type)) {
      poller.finish(sessionID);
      return;
    }

    if (!"session.status".equals(type)) return;
    JSONObject status = props.optJSONObject("status");
    if (status == null) return;
    if ("busy".equals(status.optString("type", ""))) {
      KeepaliveState.setStage(sessionID, "receiving");
      KeepaliveService.refresh();
      return;
    }
    if (!"idle".equals(status.optString("type", ""))) return;
    poller.finish(sessionID);
  }

  private void sleep(long delay) throws InterruptedException {
    Thread.sleep(delay);
  }
}
