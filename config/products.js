/**
 * name   → nome real do produto (usado no n8n / WhatsApp template / metadata)
 * label  → nome público enviado à MasterFy (extrato do banco / dashboard)
 * ref    → código de referência para identificação no funil
 * step   → posição no funil
 */
module.exports = {
  prod_698630abcbdde: { name: 'Seguro CredPix',                  label: 'Seguro CredPix',  amountCents: 3986, step: 'main',  ref: 'MAIN-SEGURO'  },
  prod_698630b497231: { name: 'Taxa IOF',                         label: 'Upsell 1',        amountCents: 3090, step: 'up1',   ref: 'UP1-IOF'      },
  prod_698630bd7f9da: { name: 'Verificação de IOF',              label: 'Upsell 2',        amountCents: 2690, step: 'up2',   ref: 'UP2-VER-IOF'  },
  prod_698630c55ec79: { name: 'Seguro Prestamista (IOF)',         label: 'Upsell 3',        amountCents: 1987, step: 'up3',   ref: 'UP3-SEG-IOF'  },
  prod_698630ccf2e75: { name: 'Ativação de Cashback',            label: 'Upsell 4',        amountCents: 3343, step: 'up4',   ref: 'UP4-CASHBACK' },
  prod_698630d77a0fa: { name: 'Antecipação Express',             label: 'Upsell 5',        amountCents: 2990, step: 'up5',   ref: 'UP5-ANTECIP'  },
  prod_698630dfecd3d: { name: 'Valor Adicional Disponível',      label: 'Upsell 6',        amountCents: 1406, step: 'up6',   ref: 'UP6-ADIC'     },
  prod_698630e72dede: { name: 'Taxa de Abertura de Crédito',    label: 'Upsell 7',        amountCents: 1692, step: 'up7',   ref: 'UP7-TAC'      },
  prod_698630eebfb78: { name: 'Taxa de Processamento',           label: 'Upsell 8',        amountCents: 3190, step: 'up8',   ref: 'UP8-PROC'     },
  prod_698630f633cec: { name: 'Taxa de Registro do Contrato',    label: 'Upsell 9',        amountCents: 2690, step: 'up9',   ref: 'UP9-REG'      },
  prod_698630ff20897: { name: 'Liberação Final',                 label: 'Upsell 10',       amountCents: 1994, step: 'up10',  ref: 'UP10-LIB'     },
  prod_69863107b709d: { name: 'Taxa de Consultoria Financeira',  label: 'Upsell 11',       amountCents: 1693, step: 'up11',  ref: 'UP11-CONS'    },
  prod_698631105cc74: { name: 'Upsell 12',                       label: 'Upsell 12',       amountCents: 2790, step: 'up12',  ref: 'UP12'         },
  prod_6986311823cf5: { name: 'Taxa de Garantia de Crédito',    label: 'Upsell 13',       amountCents: 1731, step: 'up13',  ref: 'UP13-TGC'     },
  prod_698631218da01: { name: 'Taxa de Emissão de Ficha',       label: 'Upsell 14',       amountCents: 1123, step: 'up14',  ref: 'UP14-TEF'     },
  prod_69863128c6fb7: { name: 'Taxa de Conferência',            label: 'Upsell 15',       amountCents: 1399, step: 'up15',  ref: 'UP15-TCS'     },
  prod_6986313159696: { name: 'Taxa de Cadastro Avançado',      label: 'Upsell 16',       amountCents:  887, step: 'up16',  ref: 'UP16-TCA'     },
  prod_6986313997fb8: { name: 'Taxa de Verificação',            label: 'Upsell 17',       amountCents: 1582, step: 'up17',  ref: 'UP17-TVE'     },
  prod_69863146b1a52: { name: 'Taxa de Jurisdição Legal',       label: 'Upsell 18',       amountCents: 1697, step: 'up18',  ref: 'UP18-TJL'     },
  prod_6986313fbc20c: { name: 'Taxa de Benefício Negocial',     label: 'Upsell 19',       amountCents: 1719, step: 'up19',  ref: 'UP19-TBN'     },
  prod_6986314e1cdab: { name: 'Cartão Liberado',                 label: 'Upsell 20',       amountCents: 1990, step: 'up20',  ref: 'UP20-CARTAO'  },
};
