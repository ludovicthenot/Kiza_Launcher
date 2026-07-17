import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DependencyInstallDialog } from "../../src/components/instance/discover/DependencyInstallDialog";
import type { DependencyResolution, ResolvedArtifact } from "../../src/lib/queries";

const fabricApi: ResolvedArtifact = {
  project: { provider: "modrinth", project_id: "fabric-api" },
  versionId: "fabric-api-version",
  fileId: null,
  name: "Fabric API",
  version: "1.0.0",
  fileName: "fabric-api.jar",
  downloadUrl: "https://example.invalid/fabric-api.jar",
  sha1: null,
  fileSize: 10,
  description: null,
  homepageUrl: null,
  coverUrl: null,
  gameVersions: ["1.21.1"],
  loaders: ["fabric"],
  updatedAt: null,
};

function createPlan(): DependencyResolution {
  const root = {
    ...fabricApi,
    project: { provider: "modrinth" as const, project_id: "root" },
    versionId: "root-version",
    name: "Root Mod",
    fileName: "root.jar",
  };
  return {
    context: { minecraftVersion: "1.21.1", loader: "fabric" },
    root: { artifact: root, alreadyInstalled: false },
    required: [{ artifact: fabricApi, alreadyInstalled: false }],
    optional: [
      {
        requiredBy: root.project,
        target: {
          provider: "modrinth",
          projectId: "mod-menu",
          versionId: null,
          fileId: null,
        },
        kind: "optional",
        installed: false,
      },
    ],
    incompatible: [],
    conflicts: [],
    unresolvedRequired: [],
    cycles: [],
    installOrder: [fabricApi, root],
    canInstall: true,
  };
}

describe("DependencyInstallDialog", () => {
  it("summarizes optional dependencies before confirmation with ASCII context text", () => {
    render(
      <DependencyInstallDialog
        open
        plan={createPlan()}
        result={null}
        installing={false}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText("Minecraft 1.21.1 / fabric")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Optional" })).toBeInTheDocument();
    expect(screen.getByText("mod-menu")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install 2 files" })).toBeEnabled();
  });

  it("blocks confirmation when a required file is unresolved", () => {
    const plan = createPlan();
    plan.canInstall = false;
    plan.unresolvedRequired = [
      {
        requiredBy: plan.root?.artifact.project ?? null,
        target: {
          provider: "modrinth",
          projectId: "missing-library",
          versionId: null,
          fileId: null,
        },
        reason: "No compatible file",
      },
    ];

    render(
      <DependencyInstallDialog
        open
        plan={plan}
        result={null}
        installing={false}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText("No compatible file")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install 2 files" })).toBeDisabled();
  });
});
