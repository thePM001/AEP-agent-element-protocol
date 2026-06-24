// Docking port paths aligned with AEP-Base-Node/crate/src/lib.rs

export type DockingPortId =
  | "inference_engine"
  | "validation_engine"
  | "future_features"
  | "regulation_module";

export interface DockingPortSpecWire {
  port: DockingPortId;
  name: string;
  priority: number;
  listen_path: string;
}

export function docking_port_specs(baseSocket: string): DockingPortSpecWire[] {
  return [
    {
      port: "inference_engine",
      name: "inference-engine-dock",
      priority: 200,
      listen_path: `${baseSocket}/inference`,
    },
    {
      port: "validation_engine",
      name: "validation-engine-dock",
      priority: 200,
      listen_path: `${baseSocket}/validation`,
    },
    {
      port: "future_features",
      name: "future-features-dock",
      priority: 200,
      listen_path: `${baseSocket}/future`,
    },
    {
      port: "regulation_module",
      name: "regulation-module-dock",
      priority: 150,
      listen_path: `${baseSocket}/regulation`,
    },
  ];
}