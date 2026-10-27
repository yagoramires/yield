# Roteiro: primeiro contato real com a Pluggy

O Yield só lê seus dados (contas e transações). Não move dinheiro nem inicia pagamentos.

> **Atenção, antes de tudo: faça os passos 1 a 5 dentro dos 15 dias do teste da Pluggy.** Depois do teste as conexões já feitas continuam lendo, mas a lista de conectores deixa de ser editável: não dá mais para adicionar bancos. (Actual Budget, citando o fluxo MeuPluggy: https://actualbudget.org/docs/advanced/bank-sync/pluggyai)

Tenha à mão o app de cada banco, para autorizar o compartilhamento.

## Passo a passo

1. **Crie sua conta em https://meu.pluggy.ai e conecte cada banco.** Cada banco pede uma autorização própria (uma por banco). Passo a passo oficial: https://github.com/pluggyai/meu-pluggy
2. **Crie a conta de desenvolvedor em https://dashboard.pluggy.ai** (começa o teste de 15 dias).
3. **Ligue o conector MeuPluggy:** no dashboard, **Dados Financeiros › Customização**, aba **Conectores**. Busque "MeuPluggy": ele fica em **Conectores Diretos**; deixe a chave ligada e clique em **Salvar**. Se ele não aparecer na Demo depois, desligue "Padrão para todos selecionados", ligue o MeuPluggy e salve de novo.
4. **Conecte o MeuPluggy na Demo:** em **Visão Geral**, no item "Conecte um item demo", clique em **Conectar**; escolha MeuPluggy, entre com a conta do Meu Pluggy e autorize, uma vez por banco. Com o banco conectado, o menu **⋮** no canto superior direito da Demo tem **Copiar Item ID** (um UUID, parecido com `3f1a2b3c-4d5e-6f70-8192-a3b4c5d69c02`).
5. **Copie o Client ID e o Client Secret** em **Aplicações**, na sua aplicação. Webhooks, acesso à produção, due diligence e o menu Pagamentos não são necessários.
6. No Yield, abra **Configurações › Open Finance** e clique em **Conectar bancos** (o passo a passo do app repete estes passos):
   - cole o Client ID e o Client Secret e clique em **Salvar no cofre** (ficam no cofre do sistema, o Yield nunca os mostra de volta);
   - para cada banco, escreva um nome e cole o itemId, então **Adicionar**.
7. Clique em **Testar conexão**: cada banco deve mostrar "n contas". Se aparecer erro, veja a seção "Se algo estiver estranho".
8. Clique em **↻ Sincronizar agora**. O Yield também sincroniza sozinho ao abrir (se passaram mais de 6 h). Os bancos atualizam no Meu Pluggy uma vez por dia, então o dado não é em tempo real.

## O que conferir depois da primeira sincronização

Abra **Últimos gastos › Lançamentos** e **Configurações › Contas**.

- **Contas certas:** cada banco aparece com as contas e cartões que você tem, sem conta sobrando nem em dobro.
- **Sinais:** compra no cartão é negativa; salário é positivo.
- **Fatura do cartão:** o pagamento da fatura na conta corrente não deve ser contado de novo como gasto (os gastos já estão nas compras do cartão). Confira que ele aparece como **Pagamento de fatura**. Se não aparecer, crie uma regra "sempre categorizar … como Pagamento de fatura" no próprio lançamento e mande para o Claude a descrição exata que o banco usou.
- **Aplicações:** dinheiro guardado em caixinha, CDB ou RDB deve aparecer como **Investimento**, não como gasto.
- **Conta em dobro:** se você também importou extrato (OFX/CSV) do mesmo banco, o aviso de "contada em dobro" deve aparecer no topo de Resumo e Lançamentos.
- **Pendentes:** lançamentos ainda não confirmados pelo banco aparecem marcados como pendentes.
- **Parcelas:** compras parceladas mostram n/total.
- **Sem duplicados:** sincronize uma segunda vez; a lista não deve crescer nem repetir lançamentos.

## Se algo estiver estranho

- Anote o que esperava e o que apareceu, e mande um print da tela onde viu o problema: **Configurações › Open Finance** (mensagem de erro, situação de cada banco), **Configurações › Contas** (conta repetida ou faltando) ou **Lançamentos** (sinal, duplicado, pendente).
- Conta em dobro (uma da Pluggy e outra de extrato): apague a repetida em **Configurações › Contas**. Os lançamentos dela também são apagados.
- "Client ID ou Client Secret inválidos": confira os dois no dashboard e use **Trocar**.
- Item não encontrado: o itemId está errado ou a conexão foi removida; tire o banco e adicione de novo.

## Limites conhecidos (da pesquisa)

Fonte: `docs/pesquisa-open-finance.md`, seções 1.3 a 1.5.

- O MeuPluggy grátis é cortesia da Pluggy: pode mudar sem aviso, sem SLA. Preços e FAQ: https://www.pluggy.ai/precos
- Os dados ficam armazenados na Pluggy, não só neste computador.
- A qualidade varia por banco: descrição de cartão truncada, parcelas e categorias.
- A chave guardada no app lê todos os seus dados financeiros; nunca a compartilhe nem a coloque em arquivo. Autenticação: https://docs.pluggy.ai/docs/authentication
