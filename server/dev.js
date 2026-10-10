import 'dotenv/config';
import {app} from './app.js';
app.listen(process.env.PORT||3001,()=>console.log('Nexus API running on port '+(process.env.PORT||3001)));
