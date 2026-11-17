import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, afterAll, it, expect } from "vitest";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
const exec = promisify(execFile);
let env: RulesTestEnvironment;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw Error("Émulateur local requis.");
  env = await initializeTestEnvironment({
    projectId: "demo-shena",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "counters/packages"), { value: 10 });
    await setDoc(doc(c.firestore(), "packageNumbers/SHE-PKG-000012"), {
      sequence: 12,
      packageId: "SHE-PKG-000012",
    });
    await setDoc(doc(c.firestore(), "shipments/SHE-COLIS-2024-00001"), {
      shipmentId: "SHE-COLIS-2024-00001",
      marker: "à préserver",
      orderIds: [],
    });
  });
});
afterAll(async () => {
  await env?.clearFirestore();
  await env?.cleanup();
});
it("audite sans écrire puis initialise le compteur au maximum réservé sans renuméroter", async () => {
  const run = async (apply: boolean) =>
    JSON.parse(
      (
        await exec(process.execPath, [
          "scripts/migrate-package-counter.mjs",
          "--project",
          "demo-shena",
          ...(apply ? ["--apply"] : []),
        ])
      ).stdout,
    );
  const before = await run(false);
  expect(before).toMatchObject({
    current: 10,
    highWater: 12,
    next: "SHE-PKG-000013",
    legacyCount: 1,
    reservedCount: 1,
    existingPackagesModified: 0,
  });
  await env.withSecurityRulesDisabled(async (c) => {
    expect(
      (await getDoc(doc(c.firestore(), "counters/packages"))).data()?.value,
    ).toBe(10);
  });
  await run(true);
  await run(true);
  await env.withSecurityRulesDisabled(async (c) => {
    expect(
      (await getDoc(doc(c.firestore(), "counters/packages"))).data()?.value,
    ).toBe(12);
    expect(
      (
        await getDoc(doc(c.firestore(), "shipments/SHE-COLIS-2024-00001"))
      ).data(),
    ).toEqual({
      shipmentId: "SHE-COLIS-2024-00001",
      marker: "à préserver",
      orderIds: [],
    });
  });
  // Firestore peut stocker un entier exact dans un champ de type double.
  const response = await fetch(
    "http://127.0.0.1:8080/v1/projects/demo-shena/databases/(default)/documents/counters/packages?updateMask.fieldPaths=value",
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer owner",
      },
      body: JSON.stringify({ fields: { value: { doubleValue: 100 } } }),
    },
  );
  expect(response.ok).toBe(true);
  expect(await run(false)).toMatchObject({
    current: 100,
    highWater: 100,
    next: "SHE-PKG-000101",
  });
  await run(true);
  await env.withSecurityRulesDisabled(async (c) => {
    expect(
      (await getDoc(doc(c.firestore(), "counters/packages"))).data()?.value,
    ).toBe(100);
    await setDoc(doc(c.firestore(), "counters/packages"), {
      value: "invalide",
    });
  });
  await expect(run(true)).rejects.toThrow();
  await env.withSecurityRulesDisabled(async (c) => {
    expect(
      (await getDoc(doc(c.firestore(), "counters/packages"))).data()?.value,
    ).toBe("invalide");
  });
});
