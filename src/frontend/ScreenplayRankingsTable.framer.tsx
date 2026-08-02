import { addPropertyControls, ControlType, RenderTarget } from "framer";
import {
  ScreenplayRankingsTable,
  type ScreenplayRankingsTableProps,
} from "./ScreenplayRankingsTable.js";

/** @framerSupportedLayoutWidth any-prefer-fixed @framerSupportedLayoutHeight auto */
export default function FramerScreenplayRankingsTable(props: ScreenplayRankingsTableProps) {
  return (
    <ScreenplayRankingsTable
      {...props}
      canvasMode={RenderTarget.current() === RenderTarget.canvas}
    />
  );
}

FramerScreenplayRankingsTable.defaultProps = {
  apiBaseUrl: "https://api-staging.loglisted.com",
  profilePathPrefix: "/loglist/",
  maxRows: 1000,
  initialPageSize: 25,
};

addPropertyControls(FramerScreenplayRankingsTable, {
  apiBaseUrl: {
    type: ControlType.String,
    title: "API URL",
    defaultValue: "https://api-staging.loglisted.com",
  },
  profilePathPrefix: { type: ControlType.String, title: "Profile Path", defaultValue: "/loglist/" },
  maxRows: {
    type: ControlType.Number,
    title: "Max Rows",
    defaultValue: 1000,
    min: 25,
    max: 5000,
    step: 25,
  },
  backgroundColor: { type: ControlType.Color, title: "Background", defaultValue: "#eee3d2" },
  textColor: { type: ControlType.Color, title: "Text", defaultValue: "#17130f" },
  mutedTextColor: { type: ControlType.Color, title: "Muted", defaultValue: "#72695f" },
  accentColor: { type: ControlType.Color, title: "Accent", defaultValue: "#c45f45" },
  goldColor: { type: ControlType.Color, title: "Gold", defaultValue: "#d6a85d" },
  borderColor: { type: ControlType.Color, title: "Border", defaultValue: "#c9bba8" },
  headerColor: { type: ControlType.Color, title: "Header", defaultValue: "#090b0b" },
  fontFamily: {
    type: ControlType.String,
    title: "Typography",
    defaultValue: "Cutive, Georgia, serif",
  },
  rowSpacing: {
    type: ControlType.Number,
    title: "Row Space",
    defaultValue: 18,
    min: 10,
    max: 36,
    step: 1,
  },
});
