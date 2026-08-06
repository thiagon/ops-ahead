# Anti-Corruption Layer — ITSM da Locaweb

Especifica a tradução entre o ITSM e o domínio. Vive no contexto de
[Integração](../contexts/integration.md); os termos do lado de cá estão na
[Ubiquitous Language](../ubiquitous-language.md).

Uma ACL existe quando o sistema externo tem um modelo que não queremos adotar e não temos
poder para mudar. É o caso: o ITSM é a ferramenta de operação da Locaweb, anterior a este
projeto e independente dele.

## O que a origem fala

O ITSM descreve incidents no vocabulário operacional da Locaweb, em português, com as
convenções de quem opera o dia a dia — prioridade como texto rotulado, tempos sem fuso,
booleanos como `SIM`/`NAO`, e o mesmo conceito aparecendo em mais de um campo derivado.

Esse vocabulário não é ruim: é adequado a quem o usa. Ele só não é o nosso.

## Do que a tradução protege o domínio

| A origem impõe | O domínio recebe |
|----------------|------------------|
| Vocabulário em português, específico da ferramenta | Os termos da Ubiquitous Language |
| Prioridade como rótulo textual, na escala do ITSM | `severity`, escala normalizada do domínio |
| Tempos sem fuso, na convenção local da ferramenta | Instantes absolutos, sem ambiguidade |
| Identidade no formato de chamado do ITSM | A identidade do event, gerada por nós |
| Campos derivados redundantes entre si | O que o domínio precisa, uma vez só |

A regra que sustenta tudo: **nenhum contexto além da Integração conhece qualquer um desses
termos**. Um consumidor que precise saber que a origem é o ITSM indica tradução incompleta.

## Onde a tradução acontece

Duas peças, com responsabilidades diferentes:

**O adapter da origem**, dentro da fronteira, é a ACL propriamente dita. Recebe o contrato do
ITSM, preenche os campos do domínio e preserva o evento original.

**O produtor de mock**, fora do sistema, simula o ITSM lendo a base histórica. Ele não é
parte do domínio: é um substituto do sistema externo, e existe só enquanto não há webhook
real. Quando o ITSM assumir, ele é desligado e nada mais muda.

A distinção importa porque a base histórica está no vocabulário original. **É o mock que
carrega esse dicionário**, não a fronteira — o mock é a última coisa do lado de fora, e a
fronteira já recebe o contrato do ITSM como ele é emitido, não como o arquivo histórico o
guardou.

## Regra de fronteira do vocabulário

O vocabulário original existe em exatamente dois lugares: a base histórica da Locaweb e o
mock que a lê. Nenhum código do sistema traduz nome de campo.

Do adapter em diante, vale a Ubiquitous Language. Nomear um campo novo é nomeá-lo primeiro
no contrato publicado pela fronteira; o resto do sistema segue esse nome.

Esta regra é a razão de a camada existir. Sem ela, o vocabulário do ITSM chega ao
armazenamento, aos modelos analíticos e ao treino, e trocar de origem deixa de ser
adicionar um adapter para virar renomear o sistema inteiro.

## Onde o mapeamento concreto mora

Campo a campo, a correspondência é implementação: vive no adapter e no dicionário do mock, e
o formato publicado está em [`contracts/`](../../contracts/). Este documento define **o que**
é traduzido e **por quê**; repetir a lista aqui criaria uma terceira cópia para divergir das
outras duas.

## Adicionar uma origem

Uma origem nova ganha seu próprio adapter e sua própria ACL Spec. Não altera o contrato
publicado, não altera nenhum consumidor.

Se acomodar uma origem exigir mudar o contrato, é sinal de que ela traz um conceito que o
domínio ainda não tem — e aí a discussão é sobre a Ubiquitous Language, não sobre tradução.
