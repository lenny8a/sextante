import * as vscode from 'vscode';

export const CLAVE_SISTEMA_ACTIVO = 'abapNavigator.sistemaActivo';

export class SistemaActivo {
  private readonly emisor = new vscode.EventEmitter<string | undefined>();
  readonly onDidChange: vscode.Event<string | undefined> = this.emisor.event;

  constructor(private readonly memento: vscode.Memento) {}

  get id(): string | undefined {
    return this.memento.get<string>(CLAVE_SISTEMA_ACTIVO);
  }

  dispose(): void {
    this.emisor.dispose();
  }

  async establecer(id: string | undefined): Promise<void> {
    await this.memento.update(CLAVE_SISTEMA_ACTIVO, id);
    this.emisor.fire(id);
  }
}
