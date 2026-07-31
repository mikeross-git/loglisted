import { addPropertyControls, ControlType } from "framer";
import FramerScreenplayUploader from "./FramerScreenplayUploader.js";

addPropertyControls(FramerScreenplayUploader, {
  apiBaseUrl: {
    type: ControlType.String,
    title: "API URL",
    defaultValue: "https://api-test.loglisted.com",
  },

  turnstileSiteKey: {
    type: ControlType.String,
    title: "Turnstile Key",
    defaultValue: "",
  },

  minimumPages: {
    type: ControlType.Number,
    title: "Min Pages",
    defaultValue: 25,
    min: 25,
    max: 150,
    step: 1,
  },

  accentColor: {
    type: ControlType.Color,
    title: "Accent",
    defaultValue: "#d6a85d",
  },

  surfaceColor: {
    type: ControlType.Color,
    title: "Surface",
    defaultValue: "#11100e",
  },

  textColor: {
    type: ControlType.Color,
    title: "Text",
    defaultValue: "#eee3d2",
  },

  mutedTextColor: {
    type: ControlType.Color,
    title: "Muted",
    defaultValue: "#b8ad9c",
  },

  borderColor: {
    type: ControlType.Color,
    title: "Border",
    defaultValue: "#3a3329",
  },

  borderRadius: {
    type: ControlType.Number,
    title: "Radius",
    defaultValue: 16,
    min: 0,
    max: 48,
    step: 1,
    unit: "px",
  },

  maxWidth: {
    type: ControlType.Number,
    title: "Max Width",
    defaultValue: 1180,
    min: 320,
    max: 1200,
    step: 8,
    unit: "px",
  },

  compactMode: {
    type: ControlType.Boolean,
    title: "Compact",
    defaultValue: false,
  },
});

export default FramerScreenplayUploader;
