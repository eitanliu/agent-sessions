export interface MessageEnvelope {
  id: string;
  fromSessionId: string;
  toSessionId: string;
  content: string;
  timestamp: number;
}

export interface RouteRule {
  id: string;
  sourceSessionId: string;
  targetSessionId: string;
  filter?: RegExp;
  transform?: (content: string) => string;
  enabled: boolean;
}

export type RouterEventType =
  | "message_sent"
  | "route_added"
  | "route_removed"
  | "route_error";

export interface RouterEvent {
  type: RouterEventType;
  envelope?: MessageEnvelope;
  rule?: RouteRule;
  error?: Error;
  timestamp: number;
}
