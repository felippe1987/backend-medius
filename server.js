require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { format } = require('date-fns');
const { ptBR } = require('date-fns/locale');

const app = express();
app.use(express.json());
app.use(cors());

// Configuração do MySQL com Pool de Conexões
const db = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'sjd-bd',
});

// Configuração do multer para upload de arquivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage });

// Servir arquivos estáticos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rota de Registro para Juízes e Funcionários Públicos
app.post('/register', async (req, res) => {
  const { nome, email, cpf, senha, role, cargo, departamento } = req.body;

  if (!nome || !email || !cpf || !senha || !role) {
    return res.status(400).json({ error: 'Todos os campos obrigatórios devem ser preenchidos.' });
  }

  try {
    let query, values;

    if (role === 'juiz') {
      query = 'INSERT INTO juizes (nome, email, cpf, senha, role_id) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nome_role = ?))';
      values = [nome, email, cpf, await bcrypt.hash(senha, 10), 'juiz'];
    } else if (role === 'funcionario_publico') {
      query = 'INSERT INTO funcionarios_publicos (nome, email, cpf, senha, cargo, departamento, role_id) VALUES (?, ?, ?, ?, ?, ?, (SELECT id FROM roles WHERE nome_role = ?))';
      values = [nome, email, cpf, await bcrypt.hash(senha, 10), cargo, departamento, 'funcionario_publico'];
    } else {
      return res.status(400).json({ error: 'Role inválido.' });
    }

    const [result] = await db.query(query, values);

    if (!result.insertId) {
      throw new Error('Erro ao inserir usuário no banco de dados.');
    }

    res.status(201).json({ message: 'Usuário cadastrado com sucesso!', userId: result.insertId });
  } catch (error) {
    console.error('Erro no registro:', error);
    res.status(500).json({ error: `Erro no servidor durante o registro: ${error.message}` });
  }
});

// Rota de Login
app.post('/login', async (req, res) => {
  const { email, senha } = req.body;

  try {
    const [user] = await db.query(
      `SELECT id, nome, email, senha, role_id 
       FROM juizes WHERE email = ? 
       UNION 
       SELECT id, nome, email, senha, role_id 
       FROM funcionarios_publicos WHERE email = ?`,
      [email, email]
    );

    if (user.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const usuario = user[0];
    const isMatch = await bcrypt.compare(senha, usuario.senha);

    if (!isMatch) {
      return res.status(400).json({ error: 'Senha incorreta' });
    }

    const redirectUrl = usuario.role_id === 1 ? '/home-juiz' : '/home-funcionario';

    res.status(200).json({
      message: 'Login realizado com sucesso',
      userId: usuario.id,
      redirectUrl,
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro no servidor durante o login' });
  }
});

// Configuração do multer para upload de arquivos
const storageMain = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const storageBackup = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'backup-uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
;

// Servir arquivos estáticos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rota para upload de arquivos
app.post('/api/casos/pastas/:id/arquivos', upload.single('arquivo'), async (req, res) => {
  const { id } = req.params;
  const { filename } = req.file;

  try {
    await db.query('INSERT INTO arquivos (id_pasta, nome) VALUES (?, ?)', [id, filename]);
    res.status(201).json({ message: 'Arquivo enviado com sucesso!', filename });
  } catch (error) {
    console.error('Erro ao salvar arquivo no banco:', error);
    res.status(500).json({ error: 'Erro ao salvar arquivo' });
  }
});

// Rota para listar arquivos de uma pasta
app.get('/api/casos/pastas/:id/arquivos', async (req, res) => {
  const { id } = req.params;

  try {
    const [arquivos] = await db.query('SELECT * FROM arquivos WHERE id_pasta = ?', [id]);
    res.status(200).json(arquivos);
  } catch (error) {
    console.error('Erro ao buscar arquivos:', error);
    res.status(500).json({ error: 'Erro ao buscar arquivos' });
  }
});

// Rota para excluir um arquivo
app.delete('/api/casos/arquivos/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [[arquivo]] = await db.query('SELECT nome FROM arquivos WHERE id = ?', [id]);
    if (!arquivo) return res.status(404).json({ error: 'Arquivo não encontrado' });

    // Remover arquivo do sistema de arquivos
    fs.unlinkSync(path.join(__dirname, 'uploads', arquivo.nome));

    // Remover registro do banco de dados
    await db.query('DELETE FROM arquivos WHERE id = ?', [id]);
    res.status(200).json({ message: 'Arquivo excluído com sucesso!' });
  } catch (error) {
    console.error('Erro ao excluir arquivo:', error);
    res.status(500).json({ error: 'Erro ao excluir arquivo' });
  }
});

// Rota para criar pastas
app.post('/api/casos/pastas/criar', async (req, res) => {
  const { nome } = req.body;
  if (!nome) return res.status(400).json({ error: 'O nome da pasta é obrigatório.' });

  try {
    const [result] = await db.query('INSERT INTO pastas (nome) VALUES (?)', [nome]);
    res.status(201).json({ id: result.insertId, nome });
  } catch (error) {
    console.error('Erro ao criar pasta:', error);
    res.status(500).json({ error: 'Erro ao criar pasta' });
  }
});

// Rota para listar pastas
app.get('/api/casos/pastas', async (req, res) => {
  try {
    const [pastas] = await db.query('SELECT * FROM pastas');
    res.status(200).json(pastas);
  } catch (error) {
    console.error('Erro ao buscar pastas:', error);
    res.status(500).json({ error: 'Erro ao buscar pastas' });
  }
});

// Rota para adicionar anotações
app.post('/api/casos/pastas/:id/notas', async (req, res) => {
  const { id } = req.params;
  const { texto } = req.body;

  if (!texto) return res.status(400).json({ error: 'O texto da nota é obrigatório.' });

  try {
    await db.query('INSERT INTO notas (id_pasta, texto) VALUES (?, ?)', [id, texto]);
    res.status(201).json({ message: 'Nota adicionada com sucesso!' });
  } catch (error) {
    console.error('Erro ao adicionar nota:', error);
    res.status(500).json({ error: 'Erro ao adicionar nota' });
  }
});

// Porta do servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
