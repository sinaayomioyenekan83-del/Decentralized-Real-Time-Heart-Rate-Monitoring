import { describe, it, expect, beforeEach } from "vitest";
import {
  ClarityValue,
  listCV,
  noneCV,
  principalCV,
  stringUtf8CV,
  tupleCV,
  uintCV,
} from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 300;
const ERR_INVALID_DEVICE = 301;
const ERR_NO_DATA = 302;
const ERR_INVALID_THRESHOLD = 303;
const ERR_CONTRACT_PAUSED = 304;
const ERR_ALREADY_PAUSED = 305;
const ERR_NOT_PAUSED = 306;
const ERR_INVALID_PAUSE_DURATION = 307;
const ERR_INVALID_ANOMALY_TYPE = 308;
const ERR_NO_ACCESS = 309;
const ERR_INVALID_RATE_DELTA = 310;
const ERR_INVALID_TIME_WINDOW = 311;
const ERR_NO_HISTORY = 312;
const ERR_ANOMALY_NOT_FOUND = 313;
const ERR_INVALID_RECIPIENT = 314;

interface Anomaly {
  heartRate: number;
  anomalyType: string;
  detectedAt: number;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class AnomalyDetectorMock {
  state: {
    contractOwner: string;
    isPaused: boolean;
    pauseEndTime: number;
    anomalyThresholdHigh: number;
    anomalyThresholdLow: number;
    rateDeltaThreshold: number;
    analysisTimeWindow: number;
    anomalies: Map<string, Anomaly>;
    alertRecipients: Map<string, string[]>;
  } = {
    contractOwner: "",
    isPaused: false,
    pauseEndTime: 0,
    anomalyThresholdHigh: 140,
    anomalyThresholdLow: 40,
    rateDeltaThreshold: 20,
    analysisTimeWindow: 3600,
    anomalies: new Map(),
    alertRecipients: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1OWNER";
  oracleData: Map<
    string,
    { heartRate: number; timestamp: number; oracle: string } | null
  > = new Map();
  oracleHistory: Map<string, { heartRate: number; timestamp: number }[]> =
    new Map();
  accessControl: Map<string, string> = new Map();

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      contractOwner: this.caller,
      isPaused: false,
      pauseEndTime: 0,
      anomalyThresholdHigh: 140,
      anomalyThresholdLow: 40,
      rateDeltaThreshold: 20,
      analysisTimeWindow: 3600,
      anomalies: new Map(),
      alertRecipients: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1OWNER";
    this.oracleData = new Map();
    this.oracleHistory = new Map();
    this.accessControl = new Map();
  }

  setOracleData(
    deviceId: string,
    data: { heartRate: number; timestamp: number; oracle: string } | null
  ) {
    this.oracleData.set(deviceId, data);
  }

  setOracleHistory(
    deviceId: string,
    history: { heartRate: number; timestamp: number }[]
  ) {
    this.oracleHistory.set(deviceId, history);
  }

  setAccess(deviceId: string, recipient: string, accessType: string) {
    this.accessControl.set(`${deviceId}-${recipient}`, accessType);
  }

  setAnomalyThresholds(high: number, low: number): Result<boolean> {
    if (this.caller !== this.state.contractOwner)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (high <= low || low <= 0)
      return { ok: false, value: ERR_INVALID_THRESHOLD };
    this.state.anomalyThresholdHigh = high;
    this.state.anomalyThresholdLow = low;
    return { ok: true, value: true };
  }

  setRateDeltaThreshold(delta: number): Result<boolean> {
    if (this.caller !== this.state.contractOwner)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (delta <= 0) return { ok: false, value: ERR_INVALID_RATE_DELTA };
    this.state.rateDeltaThreshold = delta;
    return { ok: true, value: true };
  }

  setAnalysisTimeWindow(window: number): Result<boolean> {
    if (this.caller !== this.state.contractOwner)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (window <= 0) return { ok: false, value: ERR_INVALID_TIME_WINDOW };
    this.state.analysisTimeWindow = window;
    return { ok: true, value: true };
  }

  addAlertRecipient(deviceId: string, recipient: string): Result<boolean> {
    if (this.state.isPaused) return { ok: false, value: ERR_CONTRACT_PAUSED };
    if (this.caller !== this.state.contractOwner)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (recipient === this.caller)
      return { ok: false, value: ERR_INVALID_RECIPIENT };
    const recipients = this.state.alertRecipients.get(deviceId) || [];
    if (recipients.length >= 50)
      return { ok: false, value: ERR_INVALID_RECIPIENT };
    this.state.alertRecipients.set(deviceId, [...recipients, recipient]);
    return { ok: true, value: true };
  }

  processData(
    deviceId: string,
    heartRate: number,
    timestamp: number
  ): Result<boolean> {
    if (this.state.isPaused) return { ok: false, value: ERR_CONTRACT_PAUSED };
    const data = this.oracleData.get(deviceId);
    if (!data) return { ok: false, value: ERR_NO_DATA };
    if (heartRate >= this.state.anomalyThresholdHigh) {
      this.state.anomalies.set(`${deviceId}-${timestamp}`, {
        heartRate,
        anomalyType: "tachycardia",
        detectedAt: this.blockHeight,
      });
      return { ok: true, value: true };
    }
    if (heartRate <= this.state.anomalyThresholdLow) {
      this.state.anomalies.set(`${deviceId}-${timestamp}`, {
        heartRate,
        anomalyType: "bradycardia",
        detectedAt: this.blockHeight,
      });
      return { ok: true, value: true };
    }
    const history = (this.oracleHistory.get(deviceId) || []).filter(
      (h) => h.timestamp >= timestamp - this.state.analysisTimeWindow
    );
    if (history.length > 0) {
      const prevRate = history[history.length - 1].heartRate;
      const delta =
        heartRate > prevRate ? heartRate - prevRate : prevRate - heartRate;
      if (delta >= this.state.rateDeltaThreshold) {
        this.state.anomalies.set(`${deviceId}-${timestamp}`, {
          heartRate,
          anomalyType: "irregular",
          detectedAt: this.blockHeight,
        });
        return { ok: true, value: true };
      }
    }
    return { ok: true, value: false };
  }

  pauseContract(duration: number): Result<boolean> {
    if (this.caller !== this.state.contractOwner)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (this.state.isPaused) return { ok: false, value: ERR_ALREADY_PAUSED };
    if (duration <= 0) return { ok: false, value: ERR_INVALID_PAUSE_DURATION };
    this.state.isPaused = true;
    this.state.pauseEndTime = this.blockHeight + duration;
    return { ok: true, value: true };
  }

  unpauseContract(): Result<boolean> {
    if (this.caller !== this.state.contractOwner)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (!this.state.isPaused) return { ok: false, value: ERR_NOT_PAUSED };
    this.state.isPaused = false;
    this.state.pauseEndTime = 0;
    return { ok: true, value: true };
  }

  getAnomaly(deviceId: string, timestamp: number): Anomaly | null {
    return this.state.anomalies.get(`${deviceId}-${timestamp}`) || null;
  }
}

describe("AnomalyDetector", () => {
  let contract: AnomalyDetectorMock;

  beforeEach(() => {
    contract = new AnomalyDetectorMock();
    contract.reset();
  });

  it("sets anomaly thresholds successfully", () => {
    const result = contract.setAnomalyThresholds(150, 30);
    expect(result.ok).toBe(true);
    expect(contract.state.anomalyThresholdHigh).toBe(150);
    expect(contract.state.anomalyThresholdLow).toBe(30);
  });

  it("sets rate delta threshold successfully", () => {
    const result = contract.setRateDeltaThreshold(25);
    expect(result.ok).toBe(true);
    expect(contract.state.rateDeltaThreshold).toBe(25);
  });

  it("sets analysis time window successfully", () => {
    const result = contract.setAnalysisTimeWindow(7200);
    expect(result.ok).toBe(true);
    expect(contract.state.analysisTimeWindow).toBe(7200);
  });

  it("adds alert recipient successfully", () => {
    const result = contract.addAlertRecipient("STDEVICE1", "ST2DOCTOR");
    expect(result.ok).toBe(true);
    expect(contract.state.alertRecipients.get("STDEVICE1")).toContain(
      "ST2DOCTOR"
    );
  });

  it("detects tachycardia anomaly", () => {
    contract.setOracleData("STDEVICE1", {
      heartRate: 150,
      timestamp: 100,
      oracle: "ST3ORACLE",
    });
    const result = contract.processData("STDEVICE1", 150, 100);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const anomaly = contract.getAnomaly("STDEVICE1", 100);
    expect(anomaly?.anomalyType).toBe("tachycardia");
  });

  it("detects bradycardia anomaly", () => {
    contract.setOracleData("STDEVICE1", {
      heartRate: 30,
      timestamp: 100,
      oracle: "ST3ORACLE",
    });
    const result = contract.processData("STDEVICE1", 30, 100);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const anomaly = contract.getAnomaly("STDEVICE1", 100);
    expect(anomaly?.anomalyType).toBe("bradycardia");
  });

  it("detects irregular anomaly", () => {
    contract.setOracleData("STDEVICE1", {
      heartRate: 80,
      timestamp: 100,
      oracle: "ST3ORACLE",
    });
    contract.setOracleHistory("STDEVICE1", [{ heartRate: 50, timestamp: 50 }]);
    const result = contract.processData("STDEVICE1", 80, 100);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const anomaly = contract.getAnomaly("STDEVICE1", 100);
    expect(anomaly?.anomalyType).toBe("irregular");
  });

  it("rejects process when paused", () => {
    contract.pauseContract(10);
    const result = contract.processData("STDEVICE1", 80, 100);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_CONTRACT_PAUSED);
  });

  it("pauses and unpauses contract", () => {
    contract.pauseContract(10);
    expect(contract.state.isPaused).toBe(true);
    const result = contract.unpauseContract();
    expect(result.ok).toBe(true);
    expect(contract.state.isPaused).toBe(false);
  });

  it("rejects invalid thresholds", () => {
    const result = contract.setAnomalyThresholds(30, 40);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_THRESHOLD);
  });

  it("rejects invalid recipient", () => {
    const result = contract.addAlertRecipient("STDEVICE1", "ST1OWNER");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_RECIPIENT);
  });

  it("rejects process with no data", () => {
    const result = contract.processData("STDEVICE1", 80, 100);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NO_DATA);
  });
});
