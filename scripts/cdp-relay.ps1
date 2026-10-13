# Conecta stdin/stdout con un puerto TCP de 127.0.0.1 en Windows.
# Lo usa check.mjs para llegar desde WSL al puerto de depuración de Chrome.
param([int]$Port)
$client = New-Object System.Net.Sockets.TcpClient('127.0.0.1', $Port)
$net = $client.GetStream()
$stdin = [Console]::OpenStandardInput()
$stdout = [Console]::OpenStandardOutput()
$up = $stdin.CopyToAsync($net)
$net.CopyTo($stdout)
$client.Close()
