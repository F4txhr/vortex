import { describe, it, expect } from "vitest";
import { parseSsHeader } from "./parsers.js";

describe("parseSsHeader", () => {
  it("should correctly parse a header with a domain name address", () => {
    // Construct a sample Shadowsocks header for google.com:443
    // Address Type: 0x03 (domain name)
    // Domain Length: 0x0a (10 bytes for "google.com")
    // Domain: "google.com"
    // Port: 443 (0x01bb)
    // Payload: "hello"

    const domain = "google.com";
    const port = 443;
    const payload = new TextEncoder().encode("hello");

    const domainBytes = new TextEncoder().encode(domain);
    const headerBuffer = new ArrayBuffer(1 + 1 + domainBytes.length + 2);
    const view = new DataView(headerBuffer);

    view.setUint8(0, 0x03); // Address Type
    view.setUint8(1, domain.length); // Domain Length
    domainBytes.forEach((byte, i) => view.setUint8(2 + i, byte));
    view.setUint16(2 + domain.length, port, false); // Port (big-endian)

    // Combine header and payload
    const fullBuffer = new Uint8Array(headerBuffer.byteLength + payload.byteLength);
    fullBuffer.set(new Uint8Array(headerBuffer), 0);
    fullBuffer.set(payload, headerBuffer.byteLength);

    const result = parseSsHeader(fullBuffer.buffer);

    expect(result.hasError).toBe(false);
    expect(result.addressRemote).toBe("google.com");
    expect(result.portRemote).toBe(443);
    expect(new TextDecoder().decode(result.rawClientData)).toBe("hello");
  });

  it("should correctly parse a header with an IPv4 address", () => {
    // Address Type: 0x01 (IPv4)
    // Address: 8.8.8.8
    // Port: 53 (0x0035)

    const port = 53;
    const ipv4Bytes = new Uint8Array([8, 8, 8, 8]);
    const headerBuffer = new ArrayBuffer(1 + 4 + 2);
    const view = new DataView(headerBuffer);

    view.setUint8(0, 0x01); // Address Type
    ipv4Bytes.forEach((byte, i) => view.setUint8(1 + i, byte));
    view.setUint16(1 + 4, port, false); // Port (big-endian)

    const result = parseSsHeader(headerBuffer);

    expect(result.hasError).toBe(false);
    expect(result.addressRemote).toBe("8.8.8.8");
    expect(result.portRemote).toBe(53);
  });
});
