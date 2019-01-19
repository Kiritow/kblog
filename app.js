const http=require('http')
const spawn=require('child_process').spawn
const promisify=require('util').promisify
const path=require('path')
const url=require('url')
const fs=require('fs')
const mime=require('mime')

let _configObj=JSON.parse(fs.readFileSync("config/config.json"))
const SOURCE_DIR=_configObj.source
const ROOT_DIR=_configObj.dist
const LISTEN_PORT=_configObj.port

async function RemoveSingleFile(filename) {
    try {
        let stats=await promisify(fs.stat)(filename)
        if(stats.isFile()) {
            console.log(`Deleting: ${filename}`)
            await promisify(fs.unlink)(filename)
        } else {
            await RemoveDirStep(filename)
            await promisify(fs.rmdir)(filename)
        }
    } catch (e) {
        console.log(`[Error] RemoveSingleFile: ${e.toString()}`)
    }
}

async function RemoveDirStep(dir) {
    try {
        let files=await promisify(fs.readdir)(dir)
        if(files && files.length>0) {
            let pArr=new Array
            files.forEach((val)=>{
                pArr.push(RemoveSingleFile(path.join(dir,val)))
            })
            return Promise.all(pArr)
        }
    } catch (e) {
        console.log(`[Error] RemoveDirStep: ${e.toString()}`)
    }
}

async function ClearSite() {
    console.log("Clearing site...")
    await RemoveDirStep(ROOT_DIR)
    console.log("[Done] Site cleaned.")
}

async function GenerateSingle(val) {
    try {
        let stat=await promisify(fs.stat)(path.join(SOURCE_DIR,val))
        if(stat && stat.isFile()) {
            if(path.extname(val).toLowerCase()==".md") {
                return new Promise((resolve,reject)=>{
                    console.log(`Generating: ${val}`)
                    let child=spawn('bin/pandoc',['-f','markdown','-t','html',path.join(SOURCE_DIR,val),'-o',path.join(ROOT_DIR,path.dirname(val),path.basename(val,path.extname(val)) + '.html')])
                    child.on('close',()=>{
                        resolve()
                    })
                })
            } else {
                console.log(`Copying: ${val}`)
                await promisify(fs.copy)(path.join(SOURCE_DIR,val),path.join(ROOT_DIR,val))
            }
        } else if(stat && stat.isDirectory()) {
            await promisify(fs.mkdir)(path.join(ROOT_DIR,val))
            await GenerateStep(val)
        }
    } catch (e) {
        console.log(`[Error] GenerateSingle: ${e.toString()}`)
    }
}

async function GenerateStep(dir) {
    try {
        let files=await promisify(fs.readdir)(path.join(SOURCE_DIR,dir))
        if(files && files.length>0) {
            let pArr=new Array
            files.forEach((val)=>{
                pArr.push(GenerateSingle(path.join(dir,val)))
            })
            await Promise.all(pArr)
        }
    } catch (e) {
        console.log(`[Error] GenerateStep: ${e.toString()}`)
    }
}

async function BuildSite() {
    console.log("Building site...")
    try {
        await GenerateStep("")
    } catch (e) {
        console.log(`[Error] BuildSite: ${e.toString()}`)
    }
    console.log("[Done] Site building done.")
}

async function RebuildSite() {
    await ClearSite()
    await BuildSite()
}

async function request_handler(req,res) {
    let obj=url.parse(req.url,true)
    if(req.method=="GET") {
        let normPath=path.normalize(decodeURI(obj.pathname))
        let localPath=path.join(ROOT_DIR,normPath)
        try {
            let stats=await promisify(fs.stat)(localPath)
            if(stats && stats.isFile()) {
                let mimeType=mime.getType(localPath)
                if(mimeType=="text/html") {
                    res.setHeader('Content-Type',mimeType + ";charset=utf-8")
                } else {
                    res.setHeader('Content-Type',mimeType)
                }
                fs.createReadStream(localPath).pipe(res)
            } else {
                let files=await promisify(fs.readdir)(localPath)
                res.writeHead(200,"OK")
                res.write(`
<html>
    <head>
        <meta http-equiv="Content-Type" content="text/html;charset=UTF-8">
        <title>Index of ${normPath}</title>
    </head>
    <body>
        <h1>Index of ${normPath}</h1>
        <table>
`)
                let pArr=new Array
                files.forEach((val)=>{
                    pArr.push(new Promise((resolve,reject)=>{
                        fs.stat(path.join(localPath,val),(err,stats)=>{
                            if(err) return reject(err)
                            else if(!stats) return reject("no stats returned.")
                            else {
                                return resolve({
                                    name:val,
                                    isfile:stats.isFile()
                                })
                            }
                        })
                    }))
                })
                for(let i=0;i<pArr.length;i++) {
                    let j=await pArr[i]
                    if(j.isfile) {
                        res.write(`<li><a href='${j.name}'>${path.basename(j.name,path.extname(j.name))}</a></li>`)
                    } else {
                        res.write(`<li>Directory <a href='${j.name}'>${path.basename(j.name,path.extname(j.name))}</a></li>`)
                    }
                }
                res.write(`
        </table>
    </body>
</html>
`)
                res.end()
            }
        } catch (e) {
            res.writeHead(500,"Server error")
            res.end(`Error: ${e.toString()}`)
        }
    }
}

async function main() {
    await RebuildSite()
    http.createServer(request_handler).listen(LISTEN_PORT)
}

let _tmBefore=new Date()
main().then(()=>{
    console.log(`Server started in ${(new Date()-_tmBefore)/1000}s.`)
})