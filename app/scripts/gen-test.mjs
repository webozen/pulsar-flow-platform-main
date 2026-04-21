import { generateKestraYaml } from "../src/lib/workflow-generator.ts";
import { writeFileSync } from "node:fs";

const { parent, worker } = generateKestraYaml({
  id: "refactor-smoke",
  name: "Refactor Smoke Test",
  description: "New generator — parent + worker subflow pair",
  triggerType: "schedule",
  triggerCron: "0 0 1 1 *",
  triggerSql: "SELECT PatNum, FName, LName FROM patient LIMIT 3",
  namespace: "dental.smile-dental",
  actions: [
    { type: "sms", to: "+15198002773", message: "Hi {{ taskrun.value.FName }} — new generator test. Reply STOP to end." },
  ],
}, { pair: true });

writeFileSync("/tmp/parent.yml", parent);
writeFileSync("/tmp/worker.yml", worker);
console.log("wrote /tmp/parent.yml and /tmp/worker.yml");
