const express = require("express");
const routerProducto = require("./src/routes/routes.js")
const { Server: http } = require("http");
const { Server: ioServer } = require("socket.io");
const User = require("./src/schema/schemaUser.js")
const { saveMsjs, getMsjs } = require("./src/controllers/mensajes.js");
const cookieParser = require("cookie-parser")
const session = require("express-session")
const MongoStore = require("connect-mongo")

const { fork } = require('child_process')
const child = fork("./child.js")

const LocalStrategy = require('passport-local').Strategy;
const passport = require("passport");
const { comparePassword, hashPassword } = require("./utils")


const { Types } = require("mongoose");

//
const cluster = require("cluster");
const {cpus} = require('os');
const cpuNum = cpus().length;
//

//logger//
require("dotenv").config();
const pino = require('pino')
const loggerError = pino('error.log')
const loggerWarn = pino('warning.log')
const loggerInfo = pino()

loggerError.level = 'error'
loggerWarn.level = 'warn'
loggerInfo.level = 'info'

//const { createSocket } = require("dgram");

const yargs = require("yargs");
const args = yargs(process.argv.slice(2))

.alias({
    m: "modo",
    p: "puerto",
    d: "debug",
})
.default({
    modo: "FORK",
    puerto: 8080,
    debug: false
})
.argv

const modoCluster = args.m === "CLUSTER";

if(modoCluster){
    console.log("Se iniciara en modo Cluster")
}else{
    console.log("Se iniciara en modo FORK")
}

/////

if(modoCluster && cluster.isPrimary){
    console.log(`Cluster iniciado. CPUS: ${cpuNum}`);
    console.log(`PID: ${process.pid}`);
    for(let i = 0; i < cpuNum; i++ ){
        cluster.fork();
    }

    cluster.on("exit", worker =>{
        console.log(`${new Date().toLocaleString()}:
        Worker ${worker.process.pid} died`);
        cluster.fork();
    });
}else{
const app = express();
const httpserver = http(app)
const io = new ioServer(httpserver)


app.use("/public", express.static('./public/'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/', routerProducto);


app.use(session({
    secret: 'STRING_TO_SING_SESSION_ID',
    resave: false,
    saveUninitialized: true,
    store: new MongoStore({
        mongoUrl: process.env.URL_BD,
        retries: 0,
        ttl: 10 * 60,
    }),
}));

app.use(passport.initialize());
app.use(passport.session());

//Log user

passport.use("login", new LocalStrategy(async (username, password, done) => {
    const user = await User.findOne({ username });
    if(user ==""){
        const passHash = user.password;
    if (!user || !comparePassword(password, passHash)) {
        return done(null, null, { message: "Invalid username or password" });
    }
    }
    return done(null, user);
}));

//Registro de usuario

passport.use("signup", new LocalStrategy({
    passReqToCallback: true
},
    async (req, username, password, done) => {
        const user = await User.findOne({ username });
        if (user) {
            return done(new Error("Usuario ya existe"),
             null);
        }
        const address = req.body.address;
        const hashedPassword = hashPassword(password);
        const newUser = new User({ username, password: hashedPassword, address });
        await newUser.save();
        return done(null, newUser);
    }));

passport.serializeUser((user, done) => {
    done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
    id = Types.ObjectId(id);
    const user = await User.findById(id);
    done(null, user);
});

//RECUPERO EL NOMBRE YA EN SESION INICIADA

app.get('/loginEnv', (req, res) => {
    loggerInfo.info(`Peticion entrante --> Ruta: ${req.url}, metodo: ${req.method}`)

    process.env.USER = req.user.address;
    const user = process.env.USER;
    loggerError.error('error de datos')
    loggerInfo.error('error de datos')
    res.send({
        user
    })
})

app.use((req, res, next)=>{
    loggerInfo.info(`Peticion entrante --> Ruta: ${req.url}, metodo: ${req.method}`)
    next()
})

app.use('*', (req, res) => {
    loggerWarn.warn('ruta incorrecta');
    loggerInfo.warn('ruta incorrecta')
    res.send("ruta incorrecta");
});

//RECUPERO EL NOMBRE YA EN SESION INICIADA
app.get('/getUserNameEnv', (req, res) => {
    loggerInfo.info(`Peticion entrante --> Ruta: ${req.url}, metodo: ${req.method}`)

    const user = process.env.USER;
    loggerError.error('error de datos')
    loggerInfo.error('error de datos')
    res.send({
        user
    })
})



app.get("/", (req, res) => {

    try {
        if (req.session.user) {
            res.sendFile(__dirname + ('/public/index.html'))
        }
        else {
            res.sendFile(__dirname + ('/views/login.html'))
        }
    }
    catch (error) {
        console.log(error)
    }

})

io.on('connection', async (socket) => {
    console.log('Usuario conectado');
    socket.on('enviarMensaje', (msj) => {
        saveMsjs(msj);
    })

    socket.emit('mensajes', await getMsjs());
})

//DEFINO EL NOMBRE DE USUARIO DE LA SESSION

app.post('/setUserName', (req, res) =>{
    req.session.user = req.body.user;
    process.env.USER = req.body.user;
    const usuario = process.env.USER;
    res.redirect('/');
})

//TOMO EL USERNAME DE LA SESSION

app.get("/getUserName", (req, res) =>{
    try{
        if(req.session.user){
            const user = process.env.USER;
            res.send({
                user,
            })
        }else
        res.send({
            username:"no existe el usuario"
        })
    }
    catch(error){
        console.log(error)
    }
})

//RECUPERO EL NOMBRE YA EN SESION INICIO

app.get('/getUserNameEnv', (req, res) =>{
    const user = process.env.USER;
    res.send({
        user
    })
})

// DESLOGUEO DE USUARIO

app.get('/logout', (req, res) => {
    try {
        req.session.destroy((err) => {
            if (err) {
                console.log(err);
            } else {
                res.redirect('/logout');
            }
        })
    } catch (err) {
        console.log(err);
    }
})
app.get('/logoutMsj', (req, res) => {
    try {
        res.sendFile(__dirname + '/views/logout.html');
    }
    catch (err) {
        console.log(err);
    }
})

//==
app.get("/info", (req, res) =>{
    res.sendFile(__dirname + "/views/info.html");
})

app.get("/api/random", (req, res) =>{
    const numsRandom = req.query.num || 500
    child.send(numsRandom)
    child.on('message', (msg) => {
        res.end(msg)
    })
})

app.get("/login", (req, res) => {
    const user = req.session.user;
    res.sendFile(__dirname + "/views/login.html");
});

app.get("/signup", (req, res) => {
    res.sendFile(__dirname + "/views/register.html");
});

app.get("/loginFail", (req, res) => {
    res.sendFile(__dirname + "/views/signupFail.html");
});

app.get("/signupFail", (req, res) => {
    res.sendFile(__dirname + "/views/signupFail.html");
});

app.post("/signup", passport.authenticate("signup", {
    failureRedirect: "signupFail",
}), (req, res) => {
    req.session.user = req.user;
    res.redirect("/login");
});

app.post("/login", passport.authenticate("login", {
    failureRedirect: "/loginFail",
}), (req, res) => {
    req.session.user = req.user;
    res.redirect("/");
});

//==

const server = httpserver.listen(args.p, () =>{
    console.log(`Server is running on port ${server.address().port}`);
});
server.on('error', error => console.log(`error running server: ${error}`));
}