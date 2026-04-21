"use client";

import { useEffect, useRef, useState } from "react";

interface Action {
  type: string;
  label?: string;
  field?: string;
  operator?: string;
  duration?: string;
  message?: string;
  to?: string;
  emailTo?: string;
  subject?: string;
}

interface FlowPreviewProps {
  name: string;
  triggerCron?: string;
  actionMode?: string;
  actions: Action[];
  taskTitle?: string;
  taskPriority?: string;
}

function escMermaid(s: string) {
  return s.replace(/"/g, "'").replace(/[[\]{}()#&]/g, " ").substring(0, 50);
}

function actionLabel(a: Action): string {
  switch (a.type) {
    case "sms": return `SMS to ${escMermaid(a.to || "patient")}`;
    case "email": return `Email: ${escMermaid(a.subject || a.emailTo || "send")}`;
    case "webhook": return "Webhook call";
    case "pause": return `Wait ${a.duration || "..."}`;
    case "approval": return "Await approval";
    case "condition": return `If ${a.field} ${a.operator || "exists"}`;
    case "create_commlog": return "Create commlog";
    case "update_appointment_status": return "Update apt status";
    case "ai_generate": return "AI generate message";
    default: return a.label || a.type;
  }
}

function buildMermaid(props: FlowPreviewProps): string {
  const lines: string[] = ["graph TD"];

  // Schedule
  if (props.triggerCron) {
    lines.push(`  SCHEDULE(("Schedule\\n${escMermaid(props.triggerCron)}"))`);
    lines.push("  SCHEDULE --> QUERY");
  }

  // Query
  lines.push(`  QUERY["Query Open Dental API"]`);
  lines.push(`  QUERY --> MATCH{"Results found?"}`);
  lines.push(`  MATCH -- "No" --> DONE_EMPTY([No action]):::skipNode`);
  lines.push(`  MATCH -- "Yes" --> FOREACH`);
  lines.push(`  FOREACH["For each result row"]`);

  if (props.actionMode === "on_approval") {
    lines.push(`  FOREACH --> TASK["Create Task\\n${escMermaid(props.taskTitle || "Review")}\\nPriority: ${props.taskPriority || "MEDIUM"}"]:::taskNode`);
    lines.push(`  TASK --> WAIT{"Staff reviews\\nand approves"}:::approvalNode`);
    if (props.actions.length > 0) {
      lines.push("  WAIT --> A0");
    } else {
      lines.push("  WAIT --> DONE([Complete]):::doneNode");
    }
  } else if (props.actionMode === "manual") {
    lines.push(`  FOREACH --> TASK["Create Task\\n(manual handling)"]:::taskNode`);
    lines.push("  TASK --> DONE([Complete]):::doneNode");
  } else {
    if (props.actions.length > 0) {
      lines.push("  FOREACH --> A0");
    } else {
      lines.push("  FOREACH --> DONE([Complete]):::doneNode");
    }
  }

  // Actions chain
  props.actions.forEach((action, i) => {
    const id = `A${i}`;
    const nextId = i < props.actions.length - 1 ? `A${i + 1}` : "DONE([Complete]):::doneNode";
    const label = actionLabel(action);

    if (action.type === "condition") {
      lines.push(`  ${id}{"${label}"}:::conditionNode`);
      lines.push(`  ${id} -- "Yes" --> ${nextId}`);
      lines.push(`  ${id} -- "No" --> SKIP_${i}([Skip]):::skipNode`);
    } else if (action.type === "approval") {
      lines.push(`  ${id}["${label}"]:::approvalNode`);
      lines.push(`  ${id} --> ${nextId}`);
    } else if (action.type === "pause") {
      lines.push(`  ${id}(["${label}"]):::pauseNode`);
      lines.push(`  ${id} --> ${nextId}`);
    } else {
      lines.push(`  ${id}["${label}"]:::actionNode`);
      lines.push(`  ${id} --> ${nextId}`);
    }
  });

  // Styles
  lines.push("  classDef actionNode fill:#f0fdf4,stroke:#22c55e,color:#166534");
  lines.push("  classDef taskNode fill:#fffbeb,stroke:#f59e0b,color:#92400e");
  lines.push("  classDef approvalNode fill:#fef3c7,stroke:#d97706,color:#92400e");
  lines.push("  classDef doneNode fill:#f0fdf4,stroke:#22c55e,color:#166534");
  lines.push("  classDef skipNode fill:#fef2f2,stroke:#ef4444,color:#991b1b");
  lines.push("  classDef conditionNode fill:#eff6ff,stroke:#3b82f6,color:#1e40af");
  lines.push("  classDef pauseNode fill:#f5f3ff,stroke:#8b5cf6,color:#5b21b6");

  return lines.join("\n");
}

export function FlowPreview(props: FlowPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const definition = buildMermaid(props);

    import("mermaid").then((mermaid) => {
      mermaid.default.initialize({
        startOnLoad: false,
        theme: "neutral",
        securityLevel: "loose",
        flowchart: { curve: "basis", padding: 15 },
      });

      const id = `mermaid-${Date.now()}`;
      mermaid.default
        .render(id, definition)
        .then((result) => {
          setSvg(result.svg);
          setError("");
        })
        .catch((err) => {
          setError(String(err));
          setSvg("");
        });
    });
  }, [props]);

  if (error) {
    return <p className="text-xs text-red-500">Diagram error: {error}</p>;
  }

  return (
    <div
      ref={containerRef}
      className="overflow-x-auto rounded-lg border bg-white p-4"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
