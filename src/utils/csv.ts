/** Read only the header for column selection. Product validation belongs to the API. */
export function readCsvHeaders(source:string):string[] {
  const text=source.replace(/^\uFEFF/,'');
  const headers:string[]=[];let value='';let quoted=false;
  for(let index=0;index<text.length;index++){
    const character=text[index];
    if(character==='"'){
      if(quoted&&text[index+1]==='"'){value+='"';index++;}
      else quoted=!quoted;
    } else if(character===','&&!quoted){headers.push(value.trim());value='';}
    else if((character==='\n'||character==='\r')&&!quoted){headers.push(value.trim());return headers;}
    else value+=character;
  }
  if(quoted)throw new Error('The CSV header has an unclosed quoted value. Correct the file and upload it again.');
  headers.push(value.trim());return headers;
}

/** Neutralize spreadsheet formulas before quoting data exported to CSV. */
export function safeCsvCell(value:string|number):string {
  let cell=String(value);
  if(/^[\s\uFEFF]*[=+\-@]/.test(cell)||/^[\t\r\n]/.test(cell))cell="'"+cell;
  return /[",\r\n]/.test(cell)?'"'+cell.replaceAll('"','""')+'"':cell;
}

