import { describe, expect, it } from "vitest";
import {
  ALERT_COOLDOWN_MS,
  decideAlert,
  downIdsOf,
  type MonitorState,
} from "../src/alert-policy";

const NOW = 1_700_000_000_000;

const report = (alerts: Array<{ id: string }>) => ({ alerts });

describe("downIdsOf", () => {
  it("deduplicates and sorts the ids worth paging about", () => {
    expect(downIdsOf(report([{ id: "r2" }, { id: "r2" }, { id: "supabase" }]))).toEqual([
      "r2",
      "supabase",
    ]);
  });

  it("is empty for a report with nothing to page about", () => {
    expect(downIdsOf({})).toEqual([]);
    expect(downIdsOf(report([]))).toEqual([]);
  });
});

describe("decideAlert", () => {
  it("alerts on the first observation of an outage", () => {
    const decision = decideAlert(null, report([{ id: "r2" }]), NOW);

    expect(decision.notify).toBe("down");
    expect(decision.state.status).toBe("down");
    expect(decision.state.downIds).toEqual(["r2"]);
    expect(decision.reason).toContain("first observation");
  });

  it("stays quiet while healthy", () => {
    const decision = decideAlert(null, report([]), NOW);

    expect(decision.notify).toBeNull();
    expect(decision.state.status).toBe("up");
  });

  it("alerts the moment a service goes down", () => {
    const previous: MonitorState = { status: "up", downIds: [], lastNotifiedAt: 0 };
    const decision = decideAlert(previous, report([{ id: "resend" }]), NOW);

    expect(decision.notify).toBe("down");
    expect(decision.reason).toContain("went down");
  });

  it("does not repeat within the cooldown", () => {
    const previous: MonitorState = { status: "down", downIds: ["r2"], lastNotifiedAt: NOW - 60_000 };
    const decision = decideAlert(previous, report([{ id: "r2" }]), NOW);

    expect(decision.notify).toBeNull();
    expect(decision.state.lastNotifiedAt).toBe(previous.lastNotifiedAt);
    expect(decision.reason).toContain("reminder not due");
  });

  it("reminds once the cooldown has passed", () => {
    const previous: MonitorState = {
      status: "down",
      downIds: ["r2"],
      lastNotifiedAt: NOW - ALERT_COOLDOWN_MS,
    };
    const decision = decideAlert(previous, report([{ id: "r2" }]), NOW);

    expect(decision.notify).toBe("down");
    expect(decision.state.lastNotifiedAt).toBe(NOW);
    expect(decision.reason).toContain("cooldown");
  });

  it("alerts again immediately when a second service joins an ongoing outage", () => {
    const previous: MonitorState = { status: "down", downIds: ["r2"], lastNotifiedAt: NOW - 60_000 };
    const decision = decideAlert(previous, report([{ id: "r2" }, { id: "supabase" }]), NOW);

    expect(decision.notify).toBe("down");
    expect(decision.state.downIds).toEqual(["r2", "supabase"]);
    expect(decision.reason).toContain("the set changed");
  });

  it("closes the loop when everything recovers", () => {
    const previous: MonitorState = { status: "down", downIds: ["r2"], lastNotifiedAt: NOW - 1_000 };
    const decision = decideAlert(previous, report([]), NOW);

    expect(decision.notify).toBe("recovered");
    expect(decision.state.status).toBe("up");
    expect(decision.state.downIds).toEqual([]);
    expect(decision.reason).toContain("was down: r2");
  });

  it("does not send a recovery email for an outage it never reported", () => {
    const previous: MonitorState = { status: "up", downIds: [], lastNotifiedAt: 0 };
    const decision = decideAlert(previous, report([]), NOW);

    expect(decision.notify).toBeNull();
  });
});
