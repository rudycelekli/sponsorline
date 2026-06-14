// Minimal ambient declaration of the subset of the VS Code / Cursor extension API
// this adapter uses. The host (Cursor, a VS Code fork) provides the real module at
// runtime; `vscode` is marked external at build time. This keeps the extension
// type-checkable offline without depending on a network install of @types/vscode.
declare module "vscode" {
  export interface Disposable {
    dispose(): void;
  }
  export enum StatusBarAlignment {
    Left = 1,
    Right = 2,
  }
  export interface StatusBarItem extends Disposable {
    text: string;
    tooltip?: string;
    command?: string;
    show(): void;
    hide(): void;
  }
  export interface WorkspaceConfiguration {
    get<T>(section: string, defaultValue: T): T;
  }
  export interface Uri {
    fsPath: string;
  }
  export interface WorkspaceFolder {
    uri: Uri;
  }
  export interface ExtensionContext {
    subscriptions: { push(...items: Disposable[]): void };
  }
  export namespace window {
    function createStatusBarItem(alignment: StatusBarAlignment, priority?: number): StatusBarItem;
    function showQuickPick(items: string[], options?: { placeHolder?: string }): Thenable<string | undefined>;
  }
  export namespace workspace {
    const workspaceFolders: WorkspaceFolder[] | undefined;
    function getConfiguration(section: string): WorkspaceConfiguration;
  }
  export namespace commands {
    function registerCommand(command: string, callback: (...args: unknown[]) => unknown): Disposable;
  }
}
