STREAMLAND vVERSION - MAC PORTABLE

ABERTURA DIRETA
No Mac, extraia o ZIP e abra Mac-Portable/Streamland.app com um duplo clique.
O Finder apresenta a app como um unico programa. Todos os seus recursos e
runtimes estao dentro do pacote .app; nao e preciso instalar dependencias.
Nao abra nem copie apenas o executavel dentro de Contents/MacOS.

IMPORTACAO NO CONSTRUTOR
1. No construtor: Software portable > Escolher pasta > Mac-Portable.
2. Em Programa para Mac, selecione Streamland.app e guarde o modulo.
3. Exporte o produto para Mac. A versao Windows usa a sua entrada Windows existente.
4. No Mac, o modulo abre Streamland.app numa janela propria do sistema/browser.
   Pode tambem abrir Streamland.app diretamente de uma pasta local, sem DMG.

Intel e Apple Silicon: o iniciador nativo e universal e escolhe os componentes
incluidos para o processador. Nao necessita de Rosetta, Node.js, Electron,
FFmpeg, FFprobe ou yt-dlp instalados separadamente. Usa o browser do sistema.
Requer macOS 13.5 ou posterior.

EXTRACAO NO MAC
Extraia o ZIP completo pelo Finder ou pelo Terminal:
  ditto -x -k "Streamland-vVERSION-Mac-Portable.zip" "$HOME/Downloads/Streamland-Portable"
Nao retire ficheiros de dentro de Streamland.app. Nao renomeie pastas internas.
O ZIP regista as permissoes Unix, diretorios e ligacoes simbolicas existentes.

IMPORTACAO NUM CONSTRUTOR WINDOWS
Extraia a pasta Mac-Portable completa e selecione-a; nao selecione o DMG nem
apenas Contents/MacOS/Streamland. A entrada correta e Streamland.app.
O Windows nao representa os bits de execucao Unix como um Mac. A importacao
pelo Windows depende de o construtor preservar/restaurar essas permissoes ao
exportar. Se o construtor avisar que as perdeu ou bloquear a exportacao, use
a versao corrigida do construtor ou extraia e importe o ZIP diretamente num Mac.
O ficheiro mac-portable-manifest.json regista os modos e os hashes originais;
nao substitui suporte a permissoes no construtor. Nao remova assinaturas para
contornar erros. Esta aplicacao ainda nao tem assinatura Developer ID/notarizacao.

DADOS E FUNCIONAMENTO
Definicoes, sessoes e chaves ficam em:
  ~/Library/Application Support/Go Streams
O nome historico desta pasta e mantido para preservar os dados ao atualizar
do Go Streams para Streamland. Nao precisa de mover os seus ficheiros.
Os videos locais mantem-se nos caminhos originais. A pasta entregue nao inclui
os seus projetos pessoais nem copias de videos. Ficheiros externos usados por
um projeto precisam de continuar acessiveis no Mac.
Encerrar Streamland termina o motor; fechar apenas a janela pode deixa-lo ativo.

VALIDACAO
Integridade, recursos, dois processadores e permissoes do ZIP verificados.
Consulte os relatorios da compilacao para os resultados de execucao nativa
e a arquitetura efetivamente testada.
O produto final exportado por um construtor externo requer validacao
separada no Mac de destino.

Criado por Antonio Fradique
https://AntonioFradique.net
