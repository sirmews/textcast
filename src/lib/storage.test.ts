import { beforeEach, describe, expect, it, vi } from "vitest";
import { storage } from "./storage";

describe("Storage Utility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should detect if OPFS is supported", () => {
    // Mock navigator.storage
    const originalNavigator = global.navigator;

    // Test supported case
    Object.defineProperty(global, "navigator", {
      value: {
        storage: {
          getDirectory: vi.fn(),
        },
      },
      configurable: true,
    });
    expect(storage.isSupported()).toBe(true);

    // Test unsupported case
    Object.defineProperty(global, "navigator", {
      value: {},
      configurable: true,
    });
    expect(storage.isSupported()).toBe(false);

    // Restore
    Object.defineProperty(global, "navigator", {
      value: originalNavigator,
      configurable: true,
    });
  });

  it("should return null if file not found in load()", async () => {
    // Mock getDirectory to throw NotFoundError
    const mockGetDirectory = vi.fn().mockImplementation(() => ({
      getFileHandle: vi
        .fn()
        .mockRejectedValue(new DOMException("File not found", "NotFoundError")),
    }));

    Object.defineProperty(global, "navigator", {
      value: {
        storage: {
          getDirectory: mockGetDirectory,
        },
      },
      configurable: true,
    });

    const result = await storage.load("non-existent.pcm");
    expect(result).toBe(null);
  });
});
