* Clase de ejemplo escrita a mano para probar la gramática (anonimizada)
class zcl_ejemplo definition public final create public.

  public section.
    types: begin of ty_fila,
             matnr type matnr,
             werks type werks_d,
             menge type p length 13 decimals 3,
           end of ty_fila.
    types tt_filas type standard table of ty_fila with non-unique key matnr.
    types tt_ordenadas type sorted table of ty_fila with unique key matnr werks.
    types tt_hash type hashed table of ty_fila with unique key matnr.
    types tt_defecto type standard table of ty_fila with default key.
    types tr_matnr type range of matnr.

    constants c_tipo_error type c length 1 value 'E'.

    class-data gv_contador type i.

    methods constructor
      importing
        iv_bukrs type bukrs optional
        iv_texto type string default 'texto'.

    methods procesar
      importing
        it_filas         type tt_filas
      returning
        value(rv_ok)     type abap_bool
      raising
        zcx_ejemplo.

  protected section.
  private section.
    data mt_log type standard table of string.
    data mo_ayudante type ref to zcl_ayudante_ejemplo.

    methods add_log
      importing
        iv_type    type c
        iv_message type string.
endclass.


class zcl_ejemplo implementation.

  method constructor.
    super->constructor( ).
    me->mo_ayudante = new #( ).
  endmethod.

  method procesar.
    data lt_x type standard table of ztab_ejemplo.
    data lv_total type i value 1000.
    field-symbols <fs> type ty_fila.

    if it_filas is initial.
      return.
    elseif lines( it_filas ) > 10 and gv_contador is not initial.
      exit.
    else.
      gv_contador = gv_contador + 1.
    endif.

    loop at it_filas assigning field-symbol(<m>) where werks = 'W001'.
      <m>-menge = <m>-menge * 2.
      check <m>-matnr is not initial.
    endloop.

    loop at it_filas into data(ls_wi).
      data(lv_campo) = ls_wi-bukrs.
      case ls_wi-werks.
        when 'W001'.
          continue.
        when others.
          clear lv_campo.
      endcase.
    endloop.

    try.
        zcl_amdp_ejemplo=>metodo( iv_valor = lv_total ).
      catch zcx_ejemplo into data(lx_error).
        add_log( iv_type = 'E' iv_message = lx_error->get_text( ) ).
    endtry.

    do 3 times.
      lv_total = lv_total - 1.
    enddo.

    while lv_total > 0.
      lv_total = lv_total - 1.
    endwhile.

    select matnr, werks
      from ztab_ejemplo
      into table @lt_x
      for all entries in @it_filas
      where matnr = @it_filas-matnr
        and werks = @it_filas-werks.

    select single * from ztab_ejemplo into @data(ls_uno) where erdat = @sy-datum.

    select a~matnr, b~werks
      from ztab_ejemplo as a
      inner join ztab_ejemplo as b on a~matnr = b~matnr
      left outer join ztab_ejemplo as c on c~matnr = a~matnr
      into table @data(lt_join).

    select distinct matnr from ztab_ejemplo into table @data(lt_dist) up to 1 rows.

    select * from ztab_ejemplo into @data(ls_fila) up to 10 rows.
    endselect.

    append ls_uno to lt_x.
    insert ls_uno into table lt_x.
    sort lt_x by matnr.
    delete adjacent duplicates from lt_x comparing matnr.
    read table lt_x into ls_uno with key matnr = '01' binary search.
    modify lt_x from ls_uno index 1 transporting matnr.
    collect ls_uno into lt_x.
    clear: ls_uno, lv_total.

    data(lt_valores) = value tt_filas( ( matnr = 'A' ) ( matnr = 'B' ) ).
    data(lv_texto) = cond string( when lv_total > 0 then `positivo` else `cero` ).
    data(lv_numero) = conv i( '42' ).
    data(lt_copia) = corresponding tt_filas( lt_valores ).
    data(lv_plantilla) = |Filas: { lines( lt_x ) } con \| escapado|.
    data(lv_cadena) = 'cadena''con comilla'.
    data(lv_largo) = strlen( lv_cadena ).
    data(lv_mes) = sy-datum+4(2).

    add_log( iv_type = 'E' iv_message = |Error en { ls_wi-bukrs }| ).
    mo_ayudante->ejecutar( ).
    add_log( iv_type = 'W' iv_message = mo_ayudante->formatear( iv_texto = lv_texto ) ).
    data(lv_attr) = mo_ayudante->mv_estado.

    if sy-subrc <> 0 or lv_texto = space.
      raise exception type zcx_ejemplo
        exporting
          textid = zcx_ejemplo=>error_general.
    endif.

    rv_ok = abap_true. " comentario al final
    message 'Texto fijo' type 'S'. "#EC NOTEXT
    data(lv_sin_texto) = 'Hola' ##NO_TEXT.
    <fs>-menge = 1.
  endmethod.

  method add_log.
    append iv_message to mt_log.
  endmethod.

endclass.
