import { describe, it, expect, beforeEach } from "vitest";
import { ClarityValue, noneCV, principalCV, stringUtf8CV, tupleCV, uintCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_DEVICE = 101;
const ERR_INVALID_DATA = 102;
const ERR_INVALID_TIMESTAMP = 103;
const ERR_ORACLE_ALREADY_EXISTS = 104;
const ERR_ORACLE_NOT_FOUND = 105;
const ERR_INVALID_HEART_RATE = 106;
const ERR_DEVICE_NOT_REGISTERED = 107;
const ERR_INVALID_SIGNATURE = 108;
const ERR_DATA_TOO_OLD = 109;
const ERR_INVALID_ORACLE_WEIGHT = 110;
const ERR_CONSENSUS_NOT_REACHED = 111;
const ERR_INVALID_CONSENSUS_THRESHOLD = 112;
const ERR_MAX_ORACLES_EXCEEDED = 113;
const ERR_INVALID_MIN_HEART_RATE = 114;
const ERR_INVALID_MAX_HEART_RATE = 115;
const ERR_INVALID_DATA_SOURCE = 116;
const ERR_PAUSED = 117;
const ERR_INVALID_PAUSE_DURATION = 118;
const ERR_ALREADY_PAUSED = 119;
const ERR_NOT_PAUSED = 120;

interface HeartRateData {
  heartRate: number;
  timestamp: number;
  oracle: string;
}

interface AuthorizedOracle {
  weight: number;
  active: boolean;
}

interface PendingSubmission {
  heartRates: number[];
  oracles: string[];
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class DataOracleMock {
  state: {
    contractOwner: string;
    isPaused: boolean;
    pauseEndTime: number;
    maxOracles: number;
    consensusThreshold: number;
    minHeartRate: number;
    maxHeartRate: number;
    dataTimeWindow: number;
    authorizedOracles: Map<string, AuthorizedOracle>;
    heartRateData: Map<string, HeartRateData>;
    heartRateHistory: Map<string, { heartRate: number; timestamp: number }[]>;
    pendingSubmissions: Map<string, PendingSubmission>;
    deviceSources: Map<string, string>;
    oracleSignatures: Map<string, Buffer>;
  } = {
    contractOwner: "",
    isPaused: false,
    pauseEndTime: 0,
    maxOracles: 10,
    consensusThreshold: 70,
    minHeartRate: 30,
    maxHeartRate: 200,
    dataTimeWindow: 300,
    authorizedOracles: new Map(),
    heartRateData: new Map(),
    heartRateHistory: new Map(),
    pendingSubmissions: new Map(),
    deviceSources: new Map(),
    oracleSignatures: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      contractOwner: this.caller,
      isPaused: false,
      pauseEndTime: 0,
      maxOracles: 10,
      consensusThreshold: 70,
      minHeartRate: 30,
      maxHeartRate: 200,
      dataTimeWindow: 300,
      authorizedOracles: new Map(),
      heartRateData: new Map(),
      heartRateHistory: new Map(),
      pendingSubmissions: new Map(),
      deviceSources: new Map(),
      oracleSignatures: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
  }

  addOracle(oracle: string, weight: number, signature: Buffer): Result<boolean> {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (this.state.authorizedOracles.size >= this.state.maxOracles) return { ok: false, value: ERR_MAX_ORACLES_EXCEEDED };
    if (this.state.authorizedOracles.has(oracle)) return { ok: false, value: ERR_ORACLE_ALREADY_EXISTS };
    if (weight <= 0) return { ok: false, value: ERR_INVALID_ORACLE_WEIGHT };
    this.state.authorizedOracles.set(oracle, { weight, active: true });
    return { ok: true, value: true };
  }

  removeOracle(oracle: string): Result<boolean> {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (!this.state.authorizedOracles.has(oracle)) return { ok: false, value: ERR_ORACLE_NOT_FOUND };
    this.state.authorizedOracles.delete(oracle);
    return { ok: true, value: true };
  }

  updateOracleWeight(oracle: string, newWeight: number): Result<boolean> {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (!this.state.authorizedOracles.has(oracle)) return { ok: false, value: ERR_ORACLE_NOT_FOUND };
    if (newWeight <= 0) return { ok: false, value: ERR_INVALID_ORACLE_WEIGHT };
    const details = this.state.authorizedOracles.get(oracle)!;
    this.state.authorizedOracles.set(oracle, { ...details, weight: newWeight });
    return { ok: true, value: true };
  }

  registerDeviceSource(deviceId: string, source: string): Result<boolean> {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (source.length === 0) return { ok: false, value: ERR_INVALID_DATA_SOURCE };
    this.state.deviceSources.set(deviceId, source);
    return { ok: true, value: true };
  }

  submitHeartRate(deviceId: string, heartRate: number, timestamp: number, signature: Buffer): Result<boolean> {
    const oracle = this.caller;
    if (this.state.isPaused) return { ok: false, value: ERR_PAUSED };
    if (!this.state.authorizedOracles.has(oracle) || !this.state.authorizedOracles.get(oracle)!.active) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (heartRate < this.state.minHeartRate || heartRate > this.state.maxHeartRate) return { ok: false, value: ERR_INVALID_HEART_RATE };
    if (timestamp < this.blockHeight - this.state.dataTimeWindow) return { ok: false, value: ERR_DATA_TOO_OLD };
    if (!this.state.deviceSources.has(deviceId)) return { ok: false, value: ERR_DEVICE_NOT_REGISTERED };
    const key = `${deviceId}-${timestamp}`;
    const pending = this.state.pendingSubmissions.get(key) || { heartRates: [], oracles: [] };
    if (pending.heartRates.length >= 10) return { ok: false, value: ERR_MAX_ORACLES_EXCEEDED };
    pending.heartRates.push(heartRate);
    pending.oracles.push(oracle);
    this.state.pendingSubmissions.set(key, pending);
    if (pending.heartRates.length >= this.state.maxOracles / 2) {
      const consensusHr = this.computeConsensus(pending.heartRates);
      this.finalizeSubmission(deviceId, consensusHr, timestamp, oracle);
      return { ok: true, value: true };
    }
    return { ok: true, value: false };
  }

  private computeConsensus(heartRates: number[]): number {
    const sorted = heartRates.slice().sort((a, b) => a - b);
    const len = sorted.length;
    const mid = Math.floor(len / 2);
    return len % 2 === 0 ? (sorted[mid] + sorted[mid - 1]) / 2 : sorted[mid];
  }

  private finalizeSubmission(deviceId: string, heartRate: number, timestamp: number, oracle: string) {
    this.state.heartRateData.set(deviceId, { heartRate, timestamp, oracle });
    const history = this.state.heartRateHistory.get(deviceId) || [];
    history.push({ heartRate, timestamp });
    if (history.length > 100) history.shift();
    this.state.heartRateHistory.set(deviceId, history);
  }

  pauseContract(duration: number): Result<boolean> {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (this.state.isPaused) return { ok: false, value: ERR_ALREADY_PAUSED };
    if (duration <= 0) return { ok: false, value: ERR_INVALID_PAUSE_DURATION };
    this.state.isPaused = true;
    this.state.pauseEndTime = this.blockHeight + duration;
    return { ok: true, value: true };
  }

  unpauseContract(): Result<boolean> {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (!this.state.isPaused) return { ok: false, value: ERR_NOT_PAUSED };
    this.state.isPaused = false;
    this.state.pauseEndTime = 0;
    return { ok: true, value: true };
  }

  setConsensusThreshold(newThreshold: number): Result<boolean> {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (newThreshold <= 50 || newThreshold > 100) return { ok: false, value: ERR_INVALID_CONSENSUS_THRESHOLD };
    this.state.consensusThreshold = newThreshold;
    return { ok: true, value: true };
  }

  setHeartRateBounds(minHr: number, maxHr: number): Result<boolean> {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (minHr <= 0) return { ok: false, value: ERR_INVALID_MIN_HEART_RATE };
    if (maxHr <= minHr) return { ok: false, value: ERR_INVALID_MAX_HEART_RATE };
    this.state.minHeartRate = minHr;
    this.state.maxHeartRate = maxHr;
    return { ok: true, value: true };
  }

  setDataTimeWindow(newWindow: number): Result<boolean> {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (newWindow <= 0) return { ok: false, value: ERR_INVALID_TIMESTAMP };
    this.state.dataTimeWindow = newWindow;
    return { ok: true, value: true };
  }

  getLatestHeartRate(deviceId: string): HeartRateData | null {
    return this.state.heartRateData.get(deviceId) || null;
  }

  getHeartRateHistory(deviceId: string): { heartRate: number; timestamp: number }[] {
    return this.state.heartRateHistory.get(deviceId) || [];
  }
}

describe("DataOracle", () => {
  let contract: DataOracleMock;

  beforeEach(() => {
    contract = new DataOracleMock();
    contract.reset();
  });

  it("adds oracle successfully", () => {
    const result = contract.addOracle("ST2ORACLE", 10, Buffer.from("sig"));
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.authorizedOracles.get("ST2ORACLE")?.weight).toBe(10);
  });

  it("rejects add oracle by non-owner", () => {
    contract.caller = "ST3FAKE";
    const result = contract.addOracle("ST2ORACLE", 10, Buffer.from("sig"));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("removes oracle successfully", () => {
    contract.addOracle("ST2ORACLE", 10, Buffer.from("sig"));
    const result = contract.removeOracle("ST2ORACLE");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.authorizedOracles.has("ST2ORACLE")).toBe(false);
  });

  it("updates oracle weight successfully", () => {
    contract.addOracle("ST2ORACLE", 10, Buffer.from("sig"));
    const result = contract.updateOracleWeight("ST2ORACLE", 20);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.authorizedOracles.get("ST2ORACLE")?.weight).toBe(20);
  });

  it("registers device source successfully", () => {
    const result = contract.registerDeviceSource("STDEVICE1", "Fitbit");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.deviceSources.get("STDEVICE1")).toBe("Fitbit");
  });

  it("rejects submit when paused", () => {
    contract.pauseContract(10);
    const result = contract.submitHeartRate("STDEVICE1", 80, 100, Buffer.from("sig"));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PAUSED);
  });

  it("pauses and unpauses contract", () => {
    const pauseResult = contract.pauseContract(10);
    expect(pauseResult.ok).toBe(true);
    expect(contract.state.isPaused).toBe(true);
    const unpauseResult = contract.unpauseContract();
    expect(unpauseResult.ok).toBe(true);
    expect(contract.state.isPaused).toBe(false);
  });

  it("sets consensus threshold successfully", () => {
    const result = contract.setConsensusThreshold(80);
    expect(result.ok).toBe(true);
    expect(contract.state.consensusThreshold).toBe(80);
  });

  it("sets heart rate bounds successfully", () => {
    const result = contract.setHeartRateBounds(40, 180);
    expect(result.ok).toBe(true);
    expect(contract.state.minHeartRate).toBe(40);
    expect(contract.state.maxHeartRate).toBe(180);
  });

  it("sets data time window successfully", () => {
    const result = contract.setDataTimeWindow(600);
    expect(result.ok).toBe(true);
    expect(contract.state.dataTimeWindow).toBe(600);
  });
});