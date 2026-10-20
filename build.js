const fs=require('fs');
process.chdir(__dirname);
const three=fs.readFileSync('node_modules/three/build/three.min.js','utf8');
const game=['physics','render','launch','net','lobby','tag','hide','game'].map(f=>fs.readFileSync('src/'+f+'.js','utf8')).join('\n');
const VERSION='2.0.0', DATE='2026.10.18';
let html=fs.readFileSync('src/template.html','utf8').replace('%VERSION%',VERSION).replace('%DATE%',DATE);
html=html.replace('<script>/*THREE*/</script>',()=>'<script>'+three+'</script>').replace('<script>/*GAME*/</script>',()=>'<script>\n'+game+'\n</script>');
fs.writeFileSync('index.html',html);
console.log('built',(html.length/1024).toFixed(0),'KB');
