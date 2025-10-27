import { describe, it, expect, beforeEach } from "vitest";
import { ClarityValue, listCV, noneCV, principalCV, stringUtf8CV, tupleCV, uintCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 200;
const ERR_INVALID_DEVICE = 201;
const ERR_INVALID_DOCTOR = 202;
const ERR_PERMISSION_EXISTS = 203;
const ERR_PERMISSION_NOT_FOUND = 204;
const ERR_INVALID_EXPIRY = 205;
const ERR_PERMISSION_EXPIRED = 206;
const ERR_INVALID_ACCESS_TYPE = 207;
const ERR_NOT_PATIENT = 208;
const ERR_MAX_PERMISSIONS_EXCEEDED = 209;
const ERR_INVALID_TIMESTAMP = 210;
const ERR_CONTRACT_PAUSED = 211;
const ERR_ALREADY_PAUSED = 212;
const ERR_NOT_PAUSED = 213;
const ERR_INVALID_PAUSE_DURATION = 214;

interface Permission {
  accessType: string;
  expiry: number;
  grantedAt: number;
}

interface AccessHistory {
  action: string;
  expiry: number;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class AccessControlMock {
  state: {
    contractOwner: string;
    isPaused: boolean;
    pauseEndTime: number;
    maxPermissionsPerDevice: number;
    permissions: Map<string, Permission>;
    patientDevices: Map<string, string[]>;
    doctorRegistry: Map<string, { registered: boolean; metadata: string }>;
    accessHistory: Map<string, AccessHistory>;
  } = {
    contractOwner: "",
    isPaused: false,
    pauseEndTime: 0,
    maxPermissionsPerDevice: 50,
    permissions: new Map(),
    patientDevices: new Map(),
    doctorRegistry: new Map(),
    accessHistory: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1PATIENT";

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      contractOwner: this.caller,
      isPaused: false,
      pauseEndTime: 0,
      maxPermissionsPerDevice: 50,
      permissions: new Map(),
      patientDevices: new Map(),
      doctorRegistry: new Map(),
      accessHistory: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1PATIENT";
  }

  registerDoctor(doctorId: string, metadata: string): Result<boolean> {
    if (this.state.isPaused) return { ok: false, value: ERR_CONTRACT_PAUSED };
    if (this.state.doctorRegistry.has(doctorId)) return { ok: false, value: ERR_INVALID_DOCTOR };
    this.state.doctorRegistry.set(doctorId, { registered: true, metadata });
    return { ok: true, value: true };
  }

  registerPatientDevice(deviceId: string, oracleContract: string): Result<boolean> {
    if (this.state.isPaused) return { ok: false, value: ERR_CONTRACT_PAUSED };
    if (this.caller !== this.state.contractOwner) return { ok: false, value: ERR_NOT_AUTHORIZED };
    const devices = this.state.patientDevices.get(this.caller) || [];
    if (devices.length >= this.state.maxPermissionsPerDevice) return { ok: false, value: ERR_MAX_PERMISSIONS_EXCEEDED };
    this.state.patientDevices.set(this.caller, [...devices, deviceId]);
    return { ok: true, value: true };
  }

  grantAccess(deviceId: string, doctorId: string, accessType: string, expiry: number, oracleContract: string): Result<boolean> {
    if (this.state.isPaused) return { ok: false, value: ERR_CONTRACT_PAUSED };
    if (!this.state.doctorRegistry.has(doctorId) || !this.state.doctorRegistry.get(doctorId)!.registered) return { ok: false, value: ERR_INVALID_DOCTOR };
    if (accessType !== "read-only" && accessType !== "read-write") return { ok: false, value: ERR_INVALID_ACCESS_TYPE };
    if (expiry <= this.blockHeight) return { ok: false, value: ERR_INVALID_EXPIRY };
    if (!(this.state.patientDevices.get(this.caller) || []).includes(deviceId)) return { ok: false, value: ERR_NOT_PATIENT };
    const key = `${deviceId}-${doctorId}`;
    if (this.state.permissions.has(key)) return { ok: false, value: ERR_PERMISSION_EXISTS };
    this.state.permissions.set(key, { accessType, expiry, grantedAt: this.blockHeight });
    this.state.accessHistory.set(`${key}-${this.blockHeight}`, { action: "grant", expiry });
    return { ok: true, value: true };
  }

  revokeAccess(deviceId: string, doctorId: string): Result<boolean> {
    if (this.state.isPaused) return { ok: false, value: ERR_CONTRACT_PAUSED };
    if (!(this.state.patientDevices.get(this.caller) || []).includes(deviceId)) return { ok: false, value: ERR_NOT_PATIENT };
    const key = `${deviceId}-${doctorId}`;
    if (!this.state.permissions.has(key)) return { ok: false, value: ERR_PERMISSION_NOT_FOUND };
    this.state.permissions.delete(key);
    this.state.accessHistory.set(`${key}-${this.blockHeight}`, { action: "revoke", expiry: 0 });
    return { ok: true, value: true };
  }

  checkAccess(deviceId: string, doctorId: string, oracleContract: string): Result<string> {
    if (this.state.isPaused) return { ok: false, value: ERR_CONTRACT_PAUSED };
    if (!this.state.doctorRegistry.has(doctorId) || !this.state.doctorRegistry.get(doctorId)!.registered) return { ok: false, value: ERR_INVALID_DOCTOR };
    const key = `${deviceId}-${doctorId}`;
    const permission = this.state.permissions.get(key);
    if (!permission) return { ok: false, value: ERR_PERMISSION_NOT_FOUND };
    if (permission.expiry < this.blockHeight) return { ok: false, value: ERR_PERMISSION_EXPIRED };
    return { ok: true, value: permission.accessType };
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

  setMaxPermissions(newMax: number): Result<boolean> {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (newMax <= 0) return { ok: false, value: ERR_MAX_PERMISSIONS_EXCEEDED };
    this.state.maxPermissionsPerDevice = newMax;
    return { ok: true, value: true };
  }

  getPermission(deviceId: string, doctorId: string): Permission | null {
    return this.state.permissions.get(`${deviceId}-${doctorId}`) || null;
  }

  getPatientDevices(patient: string): string[] {
    return this.state.patientDevices.get(patient) || [];
  }

  getDoctorInfo(doctor: string): { registered: boolean; metadata: string } | null {
    return this.state.doctorRegistry.get(doctor) || null;
  }
}

describe("AccessControl", () => {
  let contract: AccessControlMock;

  beforeEach(() => {
    contract = new AccessControlMock();
    contract.reset();
  });

  it("registers doctor successfully", () => {
    const result = contract.registerDoctor("ST2DOCTOR", "Cardiologist");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getDoctorInfo("ST2DOCTOR")?.metadata).toBe("Cardiologist");
  });

  it("registers patient device successfully", () => {
    contract.registerPatientDevice("STDEVICE1", "oracle");
    expect(contract.getPatientDevices("ST1PATIENT")).toContain("STDEVICE1");
  });

  it("grants access successfully", () => {
    contract.registerDoctor("ST2DOCTOR", "Cardiologist");
    contract.registerPatientDevice("STDEVICE1", "oracle");
    contract.blockHeight = 100;
    const result = contract.grantAccess("STDEVICE1", "ST2DOCTOR", "read-only", 200, "oracle");
    expect(result.ok).toBe(true);
    const permission = contract.getPermission("STDEVICE1", "ST2DOCTOR");
    expect(permission?.accessType).toBe("read-only");
    expect(permission?.expiry).toBe(200);
  });

  it("revokes access successfully", () => {
    contract.registerDoctor("ST2DOCTOR", "Cardiologist");
    contract.registerPatientDevice("STDEVICE1", "oracle");
    contract.grantAccess("STDEVICE1", "ST2DOCTOR", "read-only", 200, "oracle");
    const result = contract.revokeAccess("STDEVICE1", "ST2DOCTOR");
    expect(result.ok).toBe(true);
    expect(contract.getPermission("STDEVICE1", "ST2DOCTOR")).toBeNull();
  });

  it("checks access successfully", () => {
    contract.registerDoctor("ST2DOCTOR", "Cardiologist");
    contract.registerPatientDevice("STDEVICE1", "oracle");
    contract.grantAccess("STDEVICE1", "ST2DOCTOR", "read-only", 200, "oracle");
    const result = contract.checkAccess("STDEVICE1", "ST2DOCTOR", "oracle");
    expect(result.ok).toBe(true);
    expect(result.value).toBe("read-only");
  });

  it("rejects access when expired", () => {
    contract.registerDoctor("ST2DOCTOR", "Cardiologist");
    contract.registerPatientDevice("STDEVICE1", "oracle");
    contract.grantAccess("STDEVICE1", "ST2DOCTOR", "read-only", 100, "oracle");
    contract.blockHeight = 150;
    const result = contract.checkAccess("STDEVICE1", "ST2DOCTOR", "oracle");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PERMISSION_EXPIRED);
  });

  it("pauses and unpauses contract", () => {
    contract.pauseContract(10);
    expect(contract.state.isPaused).toBe(true);
    const result = contract.unpauseContract();
    expect(result.ok).toBe(true);
    expect(contract.state.isPaused).toBe(false);
  });

  it("sets max permissions successfully", () => {
    const result = contract.setMaxPermissions(100);
    expect(result.ok).toBe(true);
    expect(contract.state.maxPermissionsPerDevice).toBe(100);
  });

  it("rejects grant by non-patient", () => {
    contract.registerDoctor("ST2DOCTOR", "Cardiologist");
    contract.caller = "ST3FAKE";
    const result = contract.grantAccess("STDEVICE1", "ST2DOCTOR", "read-only", 200, "oracle");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_PATIENT);
  });

  it("rejects invalid access type", () => {
    contract.registerDoctor("ST2DOCTOR", "Cardiologist");
    contract.registerPatientDevice("STDEVICE1", "oracle");
    const result = contract.grantAccess("STDEVICE1", "ST2DOCTOR", "invalid", 200, "oracle");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_ACCESS_TYPE);
  });

  it("rejects grant when paused", () => {
    contract.pauseContract(10);
    const result = contract.grantAccess("STDEVICE1", "ST2DOCTOR", "read-only", 200, "oracle");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_CONTRACT_PAUSED);
  });
});