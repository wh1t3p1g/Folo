import { AIChatPanelStyle } from "~/atoms/settings/ai"

export const shouldRenderAISummary = ({
  aiChatPanelStyle,
  byokEnabled,
  isAIPanelVisible,
}: {
  aiChatPanelStyle: AIChatPanelStyle
  byokEnabled: boolean
  isAIPanelVisible: boolean
}) => byokEnabled || aiChatPanelStyle === AIChatPanelStyle.Floating || !isAIPanelVisible
